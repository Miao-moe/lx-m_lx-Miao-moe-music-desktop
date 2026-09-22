import fs from 'node:fs'
import path from 'node:path'
import { safeStorage } from 'electron'
import { credentialKeys, publicSettings } from '@common/sensitive'
import { writeFileAtomic } from '@common/utils/atomicFile'

const vaultName = 'credentials.json'
const journalName = 'credentials-commit.json'
const decoded = new Map<string, { raw: string, value: Record<string, string> }>()
const fail = (code: string, message: string, cause?: unknown) => Object.assign(new Error(message, { cause }), { code })
const secureStorage = () => {
  const selectedBackend = safeStorage && Reflect.get(safeStorage, 'getSelectedStorageBackend') as (() => string) | undefined
  if (!safeStorage?.isEncryptionAvailable() || (process.platform === 'linux' && (!selectedBackend || selectedBackend.call(safeStorage) === 'basic_text'))) throw fail('CREDENTIAL_STORAGE_UNAVAILABLE', '系统安全存储不可用，无法保存或读取登录凭据')
}
const encrypt = (value: unknown) => { secureStorage(); return JSON.stringify({ version: 1, encrypted: safeStorage.encryptString(JSON.stringify(value)).toString('base64') }) }
const decrypt = (raw: string): any => {
  secureStorage()
  try { const data = JSON.parse(raw); if (data.version !== 1 || typeof data.encrypted !== 'string') throw Error('Invalid vault'); return JSON.parse(safeStorage.decryptString(Buffer.from(data.encrypted, 'base64'))) } catch (cause) { throw fail('CREDENTIAL_DECRYPT_FAILED', '登录凭据无法解密，请使用原系统账户恢复，原凭据文件已保留', cause) }
}
const read = (filename: string) => { try { return fs.readFileSync(filename, 'utf8') } catch (error: any) { if (error.code === 'ENOENT') return null; throw error } }
export const serializePublicConfig = (value: Record<string, any>) => JSON.stringify({ ...value, setting: publicSettings(value.setting ?? {}) }, null, '\t')

export const recoverCredentialCommit = async(root: string) => {
  const journalPath = path.join(root, journalName)
  const raw = read(journalPath)
  if (!raw) return
  const journal = decrypt(raw) as { before: Array<string | null>, after: string[] }
  if (!Array.isArray(journal.before) || !Array.isArray(journal.after) || journal.before.length !== 2 || journal.after.length !== 2) throw fail('CREDENTIAL_RECOVERY_FAILED', '凭据保存记录损坏，已停止修改配置')
  const files = [path.join(root, vaultName), path.join(root, 'config_v2.json')]
  if (!files.every((filename, index) => read(filename) === journal.after[index])) {
    for (let index = 0; index < files.length; index++) {
      const before = journal.before[index]
      if (read(files[index]) === before) continue
      if (before === null) await fs.promises.rm(files[index], { force: true })
      else if (typeof before === 'string') await writeFileAtomic(files[index], before)
      else throw fail('CREDENTIAL_RECOVERY_FAILED', '凭据保存记录损坏，已停止修改配置')
    }
  }
  await fs.promises.rm(journalPath, { force: true })
}

export const readProtectedConfig = (filename: string, value: Record<string, any>) => {
  const raw = read(path.join(path.dirname(filename), vaultName))
  if (!raw) return value
  secureStorage()
  const cached = decoded.get(filename)
  const credentials = cached?.raw === raw ? cached.value : decrypt(raw)
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials) || Object.entries(credentials).some(([key, val]) => !credentialKeys.has(key) || typeof val !== 'string')) throw fail('CREDENTIAL_DECRYPT_FAILED', '凭据文件格式无效，原文件已保留')
  decoded.set(filename, { raw, value: credentials })
  return { ...value, setting: { ...value.setting, ...credentials } }
}

export const writeProtectedConfig = async(filename: string, value: Record<string, any>) => {
  const root = path.dirname(filename)
  await recoverCredentialCommit(root)
  const credentials = Object.fromEntries([...credentialKeys].map(key => [key, value.setting?.[key] ?? '']))
  const vaultPath = path.join(root, vaultName)
  const before = [read(vaultPath), read(filename)]
  const config = serializePublicConfig(value)
  if (before[0]) {
    const previous = readProtectedConfig(filename, {}).setting
    if ([...credentialKeys].every(key => (previous[key] ?? '') === credentials[key])) { await writeFileAtomic(filename, config); return }
  }
  // Ordinary settings still work on systems without a credential backend.
  if (!before[0] && !Object.values(credentials).some(Boolean)) { await writeFileAtomic(filename, config); return }
  const after = [encrypt(credentials), config]
  const journalPath = path.join(root, journalName)
  await writeFileAtomic(journalPath, encrypt({ before, after }))
  try {
    await writeFileAtomic(vaultPath, after[0])
    await writeFileAtomic(filename, after[1])
    decoded.set(filename, { raw: after[0], value: credentials })
  } catch (error) {
    try { await recoverCredentialCommit(root) } catch (cause) { throw fail('CREDENTIAL_RECOVERY_FAILED', '凭据保存失败且回滚未完成，请重新启动后重试', cause) }
    throw error
  }
  // Both files are committed. A leftover journal is recognized on next startup.
  await fs.promises.rm(journalPath, { force: true }).catch(() => {})
}
