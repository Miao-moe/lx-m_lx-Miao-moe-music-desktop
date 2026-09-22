import { clearLyricRaw, clearMusicUrl, clearOtherSource } from './ipc'
import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getArtworkCacheSize, clearArtworkCache } from './artworkStorage'
import { libraryCall } from './library'
import { getCoverMemorySize, clearCoverMemory } from './coverCache'
import { clearOtherSourceMemoryCache } from '@renderer/core/music/utils'

export const getCacheUsage = async() => {
  const [browser, covers, temporary, database, metadata] = await Promise.all([
    rendererInvoke<number>(WIN_MAIN_RENDERER_EVENT_NAME.get_cache_size), getArtworkCacheSize(),
    window.lx.worker.main.getTemporaryArtworkSize(), libraryCall('getDatabaseCacheSizes'),
    window.lx.worker.main.getLocalMetadataCacheSize(),
  ])
  return { browser, covers, temporary, ...database, metadata, memory: getCoverMemorySize() }
}
export type CacheCategory = keyof Awaited<ReturnType<typeof getCacheUsage>>
export const clearManagedCache = async(category?: CacheCategory) => {
  // Custom lyrics, downloaded audio and library data are intentionally excluded.
  if (!category || category === 'browser') await rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.clear_cache)
  if (!category || category === 'covers') await clearArtworkCache()
  if (category === 'memory') clearCoverMemory()
  if (!category || category === 'temporary') {
    await window.lx.worker.main.clearTemporaryArtwork()
  }
  if (!category || category === 'metadata' || category === 'temporary') await window.lx.worker.main.clearLocalMetadataCache()
  if (!category || category === 'lyrics') await clearLyricRaw()
  if (!category || category === 'urls') await clearMusicUrl()
  if (!category || category === 'sources') { clearOtherSourceMemoryCache(); await clearOtherSource() }
}
