import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { writeFileAtomic } from './atomicFile'
import { validateArtwork } from './imageLimits'

export const temporaryArtworkDirectory = path.join(os.tmpdir(), 'lx_m_music_temp')
const pending = new Map<string, Promise<string>>()
let maintenance: Promise<void> | undefined
let lastMaintenance = 0
let generation = 0
let clearing: Promise<void> | undefined
let fileCount = 0
let fileBytes = 0
const entries = async() => {
  const names = await fs.readdir(temporaryArtworkDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error })
  const result: Array<{ filename: string, bytes: number, time: number }> = []
  for (const name of names) {
    if (!/^[a-f0-9]{64}\.[a-z0-9]+$/.test(name)) continue
    const filename = path.join(temporaryArtworkDirectory, name)
    const stat = await fs.lstat(filename).catch(() => null)
    if (stat?.isFile()) result.push({ filename, bytes: stat.size, time: stat.mtimeMs })
  }
  return result
}
export const getTemporaryArtworkSize = async() => (await entries()).reduce((size, file) => size + file.bytes, 0)
export const clearTemporaryArtwork = async() => {
  if (clearing) return clearing
  generation++
  clearing = (async() => {
    await Promise.allSettled([...pending.values()])
    if (maintenance) await maintenance
    for (const file of await entries()) await fs.unlink(file.filename).catch(error => { if (error.code !== 'ENOENT') throw error })
    fileCount = 0; fileBytes = 0
  })().finally(() => { clearing = undefined })
  return clearing
}
const prune = async(keep: string) => {
  const files = (await entries()).sort((a, b) => b.time - a.time)
  let bytes = 0
  let count = 0
  for (const file of files) {
    if (file.filename !== keep && (count >= 512 || bytes + file.bytes > 128 * 1024 * 1024 || file.time < Date.now() - 7 * 86400000)) {
      await fs.unlink(file.filename).catch(() => {})
    } else { bytes += file.bytes; count++ }
  }
  fileCount = count; fileBytes = bytes
}
export const saveTemporaryArtwork = async(data: Uint8Array, format: string) => {
  if (clearing) await clearing
  validateArtwork(data)
  const key = createHash('sha256').update(data).digest('hex')
  const cleaned = format.split('/').pop()?.replace(/[^a-z0-9]/gi, '') ?? ''
  const extension = cleaned.length ? cleaned : 'img'
  const filename = path.join(temporaryArtworkDirectory, `${key}.${extension}`)
  let task = pending.get(filename)
  if (!task) {
    const current = generation
    task = (async() => {
      try { await fs.utimes(filename, new Date(), new Date()) } catch (error: any) {
        if (error.code !== 'ENOENT') throw error
        if (current !== generation) throw Object.assign(new Error('封面缓存已清理'), { code: 'ABORT_ERR' })
        await writeFileAtomic(filename, Buffer.from(data))
        fileCount++; fileBytes += data.byteLength
      }
      if (maintenance) await maintenance
      if (Date.now() - lastMaintenance > 60000 || fileCount > 512 || fileBytes > 128 * 1024 * 1024) {
        lastMaintenance = Date.now()
        // No await between this assignment and the due check; all writers share this maintenance promise.
        // eslint-disable-next-line require-atomic-updates
        maintenance = prune(filename).finally(() => { maintenance = undefined })
        await maintenance
      }
      if (current !== generation) throw Object.assign(new Error('封面缓存已清理'), { code: 'ABORT_ERR' })
      return filename
    })()
    pending.set(filename, task)
  }
  try { return await task } finally { if (pending.get(filename) === task) pending.delete(filename) }
}
