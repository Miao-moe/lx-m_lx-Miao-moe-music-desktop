import fs from 'node:fs/promises'
import path from 'node:path'
import { createLocalMusicInfo } from '@renderer/utils/music'
import { formatError } from '@common/utils/errorMessage'

const audioExtensions = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus', '.aac', '.ape', '.wma', '.aiff'])
const pathKey = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
export const scanLibraryDirectory = async(directory: string) => {
  const root = path.resolve(directory)
  const pending = [root]
  const files: Array<{ path: string, size: number }> = []
  const errors: string[] = []
  let directories = 0
  while (pending.length) {
    const current = pending.pop()!
    try {
      const entries = await fs.readdir(current, { withFileTypes: true })
      for (const entry of entries) {
        const filename = path.join(current, entry.name)
        if (entry.isDirectory()) pending.push(filename)
        else if (entry.isFile() && audioExtensions.has(path.extname(filename).toLowerCase())) {
          const stat = await fs.stat(filename)
          files.push({ path: filename, size: stat.size })
        }
      }
      if (++directories > 20000 || files.length > 100000) throw Object.assign(new Error('目录过大，请选择更小的音乐文件夹'), { code: 'LIBRARY_SCAN_LIMIT' })
    } catch (error) {
      if (current === root || (error as { code?: string }).code === 'LIBRARY_SCAN_LIMIT') throw error
      errors.push(`${current}: ${formatError(error, '读取文件夹失败')}`)
    }
  }
  return { files, errors }
}
export const inspectLibraryFiles = async(songs: LX.Music.MusicInfoLocal[]) => {
  const result: Array<{ id: string, missing: boolean }> = []
  let index = 0
  await Promise.all(Array.from({ length: Math.min(8, songs.length) }, async() => {
    while (index < songs.length) {
      const song = songs[index++]
      if (song.meta.webdav) continue
      const missing = await fs.stat(song.meta.filePath).then(stat => !stat.isFile(), error => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return true
        throw error
      })
      result.push({ id: song.id, missing })
    }
  }))
  return result
}
export const importLibraryFiles = async(files: string[]) => {
  const songs: LX.Music.MusicInfoLocal[] = []
  const errors: string[] = []
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async() => {
    while (index < files.length) {
      const filename = files[index++]
      try {
        const song = await createLocalMusicInfo(filename)
        if (!song) throw Object.assign(new Error('音频元数据无法读取'), { code: 'LOCAL_METADATA_INVALID' })
        songs.push(song)
      } catch (error) { errors.push(`${filename}: ${formatError(error, '导入失败')}`) }
    }
  }))
  songs.sort((a, b) => a.meta.filePath.localeCompare(b.meta.filePath))
  return { songs, errors }
}
export const planLibraryRelocation = async(songs: LX.Music.MusicInfoLocal[], directory: string) => {
  const { files, errors } = await scanLibraryDirectory(directory)
  const byName = new Map<string, Array<{ path: string, size: number }>>()
  for (const file of files) {
    const name = path.basename(file.path).toLowerCase()
    const group = byName.get(name) ?? []
    group.push(file)
    byName.set(name, group)
  }
  const replacements: Array<{ before: LX.Music.MusicInfoLocal, after: LX.Music.MusicInfoLocal }> = []
  const unresolved: string[] = []
  for (const song of songs) {
    if (song.meta.webdav) continue
    if (await fs.stat(song.meta.filePath).then(stat => stat.isFile(), () => false)) continue
    const candidates = (byName.get(path.basename(song.meta.filePath).toLowerCase()) ?? []).filter(file => !song.meta.fileSize || song.meta.fileSize === file.size)
    const matches: LX.Music.MusicInfoLocal[] = []
    for (const candidate of candidates) {
      if (pathKey(candidate.path) === pathKey(song.meta.filePath)) continue
      const parsed = await createLocalMusicInfo(candidate.path)
      if (!parsed || (!!song.interval && song.interval !== parsed.interval) || (!!song.singer && song.singer !== parsed.singer) || (!!song.meta.albumName && song.meta.albumName !== parsed.meta.albumName)) continue
      matches.push(parsed)
    }
    if (matches.length === 1) {
      const parsed = matches[0]
      // Stable IDs preserve favorites, playlist membership and playback history.
      replacements.push({ before: song, after: { ...song, meta: { ...song.meta, filePath: parsed.meta.filePath, songId: parsed.meta.songId, fileSize: parsed.meta.fileSize, year: parsed.meta.year } } })
    } else unresolved.push(song.meta.filePath)
  }
  return { replacements, unresolved, errors }
}
