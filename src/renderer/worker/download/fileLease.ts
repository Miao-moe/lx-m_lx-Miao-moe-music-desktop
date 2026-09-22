import fs from 'node:fs/promises'
import path from 'node:path'

const reservations = new Set<string>()
const keyOf = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file
export const reserveDownloadPath = async(directory: string, name: string, resume: boolean, skipExisting: boolean, active: () => boolean) => {
  const parsed = path.parse(path.basename(name))
  for (let index = 0; index < 10000; index++) {
    if (!active()) return null
    const fileName = parsed.name + (index ? ' (' + index + ')' : '') + parsed.ext
    const filePath = path.resolve(directory, fileName)
    const key = keyOf(filePath)
    if (reservations.has(key)) continue
    reservations.add(key)
    let created = false
    try {
      if (resume && !index) {
        const stats = await fs.lstat(filePath).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
        if (stats && (!stats.isFile() || stats.isSymbolicLink())) throw Object.assign(new Error('Invalid partial download path'), { code: 'EEXIST' })
        if (!stats) { const file = await fs.open(filePath, 'wx'); created = true; await file.close() }
      } else {
        const file = await fs.open(filePath, 'wx')
        created = true
        await file.close()
      }
      const discard = async() => {
        try { if (created) await fs.unlink(filePath) } finally { reservations.delete(key) }
      }
      if (!active()) { await discard(); return null }
      return { fileName, filePath, release: () => { reservations.delete(key) }, discard }
    } catch (error: any) {
      reservations.delete(key)
      if (error.code !== 'EEXIST' || (skipExisting && !index)) throw error
    }
  }
  throw Object.assign(new Error('No available download filename'), { code: 'EEXIST' })
}
