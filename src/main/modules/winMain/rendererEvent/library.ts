import fs from 'node:fs'
import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import type { LibraryPreferences } from '@common/library'
import { sendEvent } from '../main'

const allowed = new Set(['getLibraryPreferences', 'saveLibraryPreferences', 'getListHistory', 'getListHistoryDiff', 'captureListHistory', 'getListeningHistory', 'clearListeningHistory', 'recordListening', 'getLibraryCatalog', 'getLibraryFacets', 'getLibraryLocalFiles', 'setLibraryFileStatus', 'getSmartPlaylist', 'getDatabaseCacheSizes'])
const watches = new Map<string, fs.FSWatcher>()
const timers = new Map<string, NodeJS.Timeout>()
const watchFolders = (prefs: LibraryPreferences) => {
  const paths = new Set(prefs.folders.filter(folder => folder.enabled).map(folder => folder.path))
  for (const [path, watcher] of watches) if (!paths.has(path)) { watcher.close(); watches.delete(path); clearTimeout(timers.get(path)); timers.delete(path) }
  for (const path of paths) {
    if (watches.has(path)) continue
    try {
      const watcher = fs.watch(path, { recursive: true, persistent: false }, () => {
        clearTimeout(timers.get(path))
        timers.set(path, setTimeout(() => { timers.delete(path); sendEvent(WIN_MAIN_RENDERER_EVENT_NAME.library_folder_changed, path) }, 1000))
      })
      watcher.on('error', () => { watcher.close(); watches.delete(path) }) // Periodic scans also cover disconnected volumes and platforms without recursive watch.
      watches.set(path, watcher)
    } catch {} // Folder scan reports the concrete error in the library UI.
  }
}
export default () => {
  mainHandle<{ method: string, args: any[] }, unknown>(WIN_MAIN_RENDERER_EVENT_NAME.library_action, async({ params }) => {
    if (!params || !allowed.has(params.method) || !Array.isArray(params.args)) throw Object.assign(new Error('无效的曲库操作'), { code: 'LIBRARY_ACTION_INVALID' })
    const service = global.lx.worker.dbService as unknown as Record<string, (...args: any[]) => Promise<any>>
    const result = await service[params.method](...params.args)
    if (params.method === 'getLibraryPreferences') watchFolders(result)
    if (params.method === 'saveLibraryPreferences') watchFolders(params.args[0])
    return result
  })
}
