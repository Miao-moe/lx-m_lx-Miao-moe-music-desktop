import getStore, { withStoreExclusive, protectStoreRecovery } from '@main/utils/store'
import { mergeSetting } from '@main/utils'
import { serializePublicConfig } from '@main/utils/credentials'
import { STORE_NAMES } from '@common/constants'
import { playlistDiff } from '@common/syncDiff'
import { createClient, type RemoteFile } from './client'
import { hash, normalizeData, parseSnapshot, selectedSections, validateData } from './data'
import { planSync, type Baseline } from './plan'
import { WebDAVError } from './errors'
import { errorForTransport, getErrorInfo } from '@common/utils/errorMessage'

const state = { busy: false }
interface Restored { dislike?: string, hashes?: Partial<Record<LX.WebDAV.Section, string>> }
// One bounded remote document. A 304 reuses its parsed data as well as its body.
let cached: { identity: string, file: RemoteFile, snapshot: LX.WebDAV.Snapshot, normalized: LX.WebDAV.Data, validated: Set<LX.WebDAV.Section>, hashes: Partial<Record<LX.WebDAV.Section, string>> } | undefined
export const getWebDAVLastResult = (): LX.WebDAV.Result | null => getStore('webdav').get<LX.WebDAV.Result>('lastResult') ?? null

const applyLocal = async(data: LX.WebDAV.Data, sections: LX.WebDAV.Section[], revision: string, checkSettings: () => void) => withStoreExclusive(async() => {
  checkSettings()
  const config = getStore(STORE_NAMES.APP_SETTINGS)
  const change = data.settings ? mergeSetting(config.get<LX.AppSetting>('setting') ?? global.lx.appSetting, data.settings) : undefined
  const next = change ? { ...config.snapshot(), setting: change.setting } : undefined
  let restored: Restored
  try {
    restored = await global.lx.worker.dbService.webdavRestore(global.lxDataPath, data, next ? [{ name: 'config_v2.json', data: serializePublicConfig(next) }] : [], sections, revision)
    protectStoreRecovery(null)
  } catch (error) {
    if (String(error).includes('backup:rollback_failed')) protectStoreRecovery(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
  if (next && change) {
    config.acceptCommitted(next)
    restored.hashes = { ...restored.hashes, settings: hash(normalizeData({ settings: change.setting }, ['settings']).settings) }
  }
  // Notify renderers only after every selected section has committed.
  const notify = (action: () => void) => { try { action() } catch (error) { console.error('WebDAV committed notification failed', errorForTransport(error)) } }
  if (change) notify(() => { global.lx.event_app.config_committed(change.setting, change.updatedSettingKeys, change.updatedSetting) })
  if (data.playlists) notify(() => { global.lx.event_list.list_data_restored(data.playlists!) })
  if (restored.dislike !== undefined) notify(() => { global.lx.event_dislike.dislike_data_restored(restored.dislike!) })
  return restored
})

export const runWebDAV = async(operation: LX.WebDAV.Operation): Promise<LX.WebDAV.Result> => {
  const result: LX.WebDAV.Result = { success: false, operation, time: Date.now(), uploaded: [], downloaded: [] }
  if (state.busy) return { ...result, error: 'busy' }
  state.busy = true
  try {
    const settings = { ...global.lx.appSetting }
    if (!['test', 'sync', 'upload', 'download'].includes(operation)) throw new WebDAVError('invalid_config')
    if (operation !== 'test' && !settings['sync.webdav.enable']) throw new WebDAVError('disabled')
    const client = createClient({ url: settings['sync.webdav.url'], username: settings['sync.webdav.username'], password: settings['sync.webdav.password'], directory: settings['sync.webdav.directory'] })
    if (operation === 'test') await client.test()
    else {
      const sections = selectedSections(settings)
      if (!sections.length) throw new WebDAVError('empty_selection')
      const storage = getStore('webdav')
      const identity = hash(client.identity)
      const cacheIdentity = hash([client.identity, settings['sync.webdav.password']])
      if (cached?.identity !== cacheIdentity) cached = undefined
      const baseline = storage.get<{ identity: string, data: Baseline }>('baseline')
      const previous = baseline?.identity === identity ? baseline.data : {}
      const captured = await global.lx.worker.dbService.webdavRead(sections)
      const raw = { ...captured.data, ...(sections.includes('settings') ? { settings } : {}) }
      validateData(raw, sections)
      const local = normalizeData(raw, sections)
      const localHashes = Object.fromEntries(sections.map(section => [section, hash(local[section])]))
      const remoteFile = await client.read(cached?.file)
      if (operation === 'download' && remoteFile.content == null) throw new WebDAVError('missing_remote')
      const remote = remoteFile.unchanged && cached ? cached.snapshot : remoteFile.content == null ? { type: 'lx-music-webdav' as const, version: 1 as const, updatedAt: 0, data: {} } : parseSnapshot(remoteFile.content)
      const normalized = remoteFile.unchanged && cached ? cached.normalized : {}
      const validated = remoteFile.unchanged && cached ? cached.validated : new Set<LX.WebDAV.Section>()
      const unchecked = sections.filter(section => !validated.has(section))
      validateData(remote.data, unchecked)
      Object.assign(normalized, normalizeData(remote.data, unchecked))
      for (const section of unchecked) validated.add(section)
      const remoteData: LX.WebDAV.Data = Object.fromEntries(sections.map(section => [section, normalized[section]]))
      const remoteHashes = remoteFile.unchanged && cached ? cached.hashes : {}
      for (const section of sections) remoteHashes[section] ??= hash(remoteData[section])
      // eslint-disable-next-line require-atomic-updates -- The busy guard serializes all access to this cache.
      cached = { identity: cacheIdentity, file: remoteFile, snapshot: remote, normalized, validated, hashes: remoteHashes }
      const hashes: Baseline = Object.fromEntries(sections.map(section => [section, { local: localHashes[section], remote: remoteHashes[section]! }]))
      let plan: ReturnType<typeof planSync>
      try { plan = planSync(operation, local, remoteData, previous, sections, hashes) } catch (error) {
        if (error instanceof WebDAVError && error.code === 'conflict' && local.playlists && remoteData.playlists) result.diff = playlistDiff(local.playlists, remoteData.playlists)
        throw error
      }
      const settingHash = hash(local.settings)
      const checkSettings = () => {
        const changed = (Object.keys(settings) as Array<keyof LX.AppSetting>).some(key => key.startsWith('sync.webdav.') && settings[key] !== global.lx.appSetting[key])
        if (changed || (sections.includes('settings') && hash(normalizeData({ settings: global.lx.appSetting }, ['settings']).settings) !== settingHash)) throw new WebDAVError('local_changed')
      }
      const checkLocal = async() => {
        checkSettings()
        if (await global.lx.worker.dbService.webdavRevision(sections) !== captured.revision) throw new WebDAVError('local_changed')
      }
      await checkLocal()
      if (plan.download.length) await getStore('webdav-local-backup').override({ type: 'lx-music-webdav', version: 1, updatedAt: Date.now(), data: Object.fromEntries(plan.download.map(section => [section, section === 'settings' ? local.settings : raw[section]])) })
      if (plan.upload.length) {
        const upload: LX.WebDAV.Snapshot = { ...remote, updatedAt: Date.now(), data: { ...remote.data, ...Object.fromEntries(plan.upload.map(section => [section, local[section]])) } }
        const file = await client.write(JSON.stringify(upload), remoteFile)
        // eslint-disable-next-line require-atomic-updates -- The busy guard stays held until the result is persisted.
        cached = { identity: cacheIdentity, file, snapshot: upload, normalized: { ...normalized, ...Object.fromEntries(plan.upload.map(section => [section, local[section]])) }, validated, hashes: { ...remoteHashes, ...Object.fromEntries(plan.upload.map(section => [section, localHashes[section]])) } }
        result.uploaded = plan.upload
      }
      let restored: Restored = {}
      if (plan.download.length) {
        await checkLocal()
        restored = await applyLocal(Object.fromEntries(plan.download.map(section => [section, remoteData[section]])), sections, captured.revision, checkSettings)
        result.downloaded = plan.download
      }
      const next: Baseline = { ...previous }
      for (const section of sections) {
        next[section] = {
          local: plan.download.includes(section) ? restored.hashes?.[section] ?? (section === 'dislike' ? hash(restored.dislike) : remoteHashes[section]!) : localHashes[section],
          remote: plan.upload.includes(section) ? localHashes[section] : remoteHashes[section]!,
        }
      }
      await storage.set('baseline', { identity, data: next })
    }
    result.success = true
  } catch (error) {
    if (error instanceof WebDAVError) {
      result.error = error.code; result.sections = error.sections; result.statusCode = error.statusCode
      if (error.cause) result.diagnostic = errorForTransport(error.cause).message
    } else {
      // Worker exceptions cross IPC as a readable code prefix.
      const { code } = getErrorInfo(error)
      result.error = ['local_changed', 'downloads_running', 'invalid_data'].includes(code) ? code as LX.WebDAV.ErrorCode : 'local_error'
      result.diagnostic = errorForTransport(error).message
    }
  }
  result.time = Date.now()
  try {
    result.lastSuccess = result.success && operation !== 'test' ? result.time : getWebDAVLastResult()?.lastSuccess
    await getStore('webdav').set('lastResult', result)
  } catch { /* Still returned to the caller. */ } finally { state.busy = false }
  return result
}
