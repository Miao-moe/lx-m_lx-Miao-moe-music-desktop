import { ref } from '@common/utils/vueTools'
import { libraryCall, libraryError, libraryPreferences, refreshLibraryPreferences } from './library'
import { formatError } from '@common/utils/errorMessage'
import { addListMusics, userLists, getListMusics, overwriteListMusics } from '@renderer/store/list/listManage'
import type { LibraryFolder } from '@common/library'

export const libraryScanning = ref(false)
export const libraryMissingCount = ref(0)
export const folderScanResults = ref<Record<string, string>>({})
let pending: Promise<void> | undefined
const samePath = (filename: string) => process.platform === 'win32' ? filename.replace(/\\/g, '/').toLowerCase() : filename
export const checkLibraryFiles = async() => {
  const songs = await libraryCall('getLibraryLocalFiles')
  const states = await window.lx.worker.main.inspectLibraryFiles(songs)
  await libraryCall('setLibraryFileStatus', states)
  libraryMissingCount.value = states.filter(item => item.missing).length
  return libraryMissingCount.value
}
const scanFolder = async(folder: LibraryFolder) => {
  if (!userLists.some(list => list.id === folder.listId) && !['default', 'love'].includes(folder.listId)) return
  const scan = await window.lx.worker.main.scanLibraryDirectory(folder.path)
  const current = await getListMusics(folder.listId)
  const existing = new Set(current.filter(song => song.source === 'local').map(song => samePath((song as LX.Music.MusicInfoLocal).meta.filePath)))
  const paths = scan.files.map(file => file.path).filter(path => !existing.has(samePath(path)))
  let count = 0
  const errors = [...scan.errors]
  for (let index = 0; index < paths.length; index += 100) {
    if (!libraryPreferences.value.folders.some(item => item.path === folder.path && item.listId === folder.listId && item.enabled)) return
    const result = await window.lx.worker.main.importLibraryFiles(paths.slice(index, index + 100))
    if (!libraryPreferences.value.folders.some(item => item.path === folder.path && item.listId === folder.listId && item.enabled)) return
    if (result.songs.length) await addListMusics({ id: folder.listId, musicInfos: result.songs, addMusicLocationType: 'bottom' })
    count += result.songs.length
    errors.push(...result.errors)
  }
  folderScanResults.value[folder.path] = `${new Date().toLocaleTimeString()}：新增 ${count} 首${errors.length ? '；' + errors.join('\n') : ''}`
}
export const refreshSmartPlaylist = async(id: string) => {
  const rule = libraryPreferences.value.lists[id]?.smart
  if (!rule || !userLists.some(list => list.id === id)) return
  const songs = await libraryCall('getSmartPlaylist', rule, id)
  const current = await getListMusics(id)
  if (JSON.stringify(current) === JSON.stringify(songs)) return
  await overwriteListMusics({ listId: id, musicInfos: songs }, true)
}
export const refreshLibrary = async() => {
  if (pending) return pending
  pending = (async() => {
    libraryScanning.value = true
    libraryError.value = ''
    try {
      await refreshLibraryPreferences()
      for (const folder of libraryPreferences.value.folders) {
        if (!folder.enabled) continue
        try { await scanFolder(folder) } catch (error) { folderScanResults.value[folder.path] = formatError(error, '扫描文件夹失败') }
      }
      await checkLibraryFiles()
      for (const [id, config] of Object.entries(libraryPreferences.value.lists)) if (config.smart) await refreshSmartPlaylist(id)
    } catch (error) { libraryError.value = formatError(error, '刷新曲库失败') } finally { libraryScanning.value = false; pending = undefined }
  })()
  return pending
}
