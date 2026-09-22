import { errorForTransport } from '@common/utils/errorMessage'
import { showLoadError } from '@common/loadErrorNotice'
import { createUserList, overwriteListMusics, updateUserList } from '@renderer/store/list/action'
import { userLists } from '@renderer/store/list/listManage/state'
import { COOKIE_SOURCES, SOURCE_NAME, getCookie, hasCookie, isCookieRecognized, isFavListSyncEnabled, type CookieSource } from './cookieManager'
import { getRemotePlaylists, getRemoteSongs, type RemotePlaylist, type CookieSyncResult, type CookieSyncDetail } from './cookiePlaylistApi'
import { refreshBoundPlaylist } from './playlistWriteback'
import { queuePlaylistSync } from './syncQueue'
import { appSetting } from '@renderer/store/setting'
import { beginSync, progressSync, finishSync } from '@renderer/store/syncStatus'
import { readPlatformSelection } from './platformSyncSelection'
export { checkCookiePlaylists } from './cookiePlaylistApi'
export type { RemotePlaylist, CookieSyncResult, CookieSyncDetail, CookiePlaylistCheck } from './cookiePlaylistApi'

let syncTask: Promise<CookieSyncResult> | null = null
const buildSyncListId = (source: CookieSource, remoteId: string) => `userlist_${source}_sync_${remoteId}`
const findSyncedList = (source: CookieSource, remoteId: string) => userLists.find(list => list.id === buildSyncListId(source, remoteId))
const syncOnePlaylist = async(source: CookieSource, playlist: RemotePlaylist, songs: LX.Music.MusicInfo[]) => {
  const validSongs = songs.filter(s => s?.id)
  const id = buildSyncListId(source, playlist.id)
  const name = `${SOURCE_NAME[source]} - ${playlist.name}`
  const localList = findSyncedList(source, playlist.id)
  if (localList) {
    if (localList.name !== name || localList.source !== source || localList.sourceListId !== playlist.id) {
      await updateUserList([{ ...localList, name, source, sourceListId: playlist.id }], true)
    }
    await overwriteListMusics({ listId: id, musicInfos: validSongs }, true)
  } else {
    await createUserList({ id, name, source, sourceListId: playlist.id, list: validSongs }, true)
  }
}

const syncSource = async(source: CookieSource, cookie: string, captured?: RemotePlaylist[]): Promise<{ listCount: number, count: number, failed: number, total: number, message?: string }> => {
  const sourceKey = 'cookie:' + source
  beginSync(sourceKey, `${SOURCE_NAME[source]} 歌单同步`)
  let all: RemotePlaylist[]
  try { all = await getRemotePlaylists(source, cookie, captured) } catch (error) { finishSync(sourceKey, error); throw error }
  const choice = readPlatformSelection(appSetting['sync.platform.selection'])[source]
  const selected = new Set(choice?.ids ?? [])
  const playlists = all.filter(list => !choice || choice.mode === 'all' || (choice.mode === 'include' ? selected.has(list.id) : !selected.has(list.id)))
  progressSync(sourceKey, 0, playlists.length)
  let listCount = 0
  let count = 0
  let failed = 0
  let message = ''
  await Promise.all(playlists.map(async playlist => queuePlaylistSync(source, async() => {
    const key = sourceKey + ':' + playlist.id
    beginSync(key, `${SOURCE_NAME[source]} · ${playlist.name}`)
    try {
      let songs: LX.Music.MusicInfo[] = []
      await refreshBoundPlaylist(buildSyncListId(source, playlist.id), async() => getRemoteSongs(source, cookie, playlist), async result => {
        songs = result
        if (getCookie(source) !== cookie) throw new Error('平台登录信息已改变，请重新同步')
        await syncOnePlaylist(source, playlist, songs)
      })
      listCount++
      count += songs.length
      finishSync(key)
    } catch (err) {
      failed++
      message = errorForTransport(err).message
      console.warn(`[cookieSync] ${source} playlist "${playlist.name}" sync failed:`, err)
      finishSync(key, err)
    }
    progressSync(sourceKey, listCount + failed, playlists.length)
  })))
  finishSync(sourceKey, failed ? { code: 'COOKIE_SYNC_PARTIAL', message: `${failed} 个歌单失败，${listCount} 个成功。${message}` } : undefined)
  return { listCount, count, failed, total: playlists.length, ...(message ? { message } : {}) }
}

const syncChains = new Map<string, Promise<unknown>>()
const serializeSync = async<T>(source: string, fn: () => Promise<T>): Promise<T> => {
  const result = (syncChains.get(source) ?? Promise.resolve()).then(fn, fn)
  syncChains.set(source, result)
  try { return await result } finally { if (syncChains.get(source) === result) syncChains.delete(source) }
}

export const syncCookiePlaylists = async(source: CookieSource, captured?: RemotePlaylist[]): Promise<CookieSyncResult> => {
  const cookie = getCookie(source)
  if (!hasCookie(source) || !isCookieRecognized(source, cookie)) {
    return { synced: false, listCount: 0, count: 0, message: 'cookie_unrecognized' }
  }
  return serializeSync(source, async() => syncSource(source, cookie, captured))
    .then(({ listCount, count, failed, total, message }) => ({
      synced: listCount > 0 || total === 0,
      listCount,
      count,
      error: failed > 0,
      ...(message ? { message } : {}),
    }))
    .catch((err: any) => {
      console.warn(`[cookieSync] ${source} sync failed:`, err)
      return { synced: false, listCount: 0, count: 0, error: true, message: errorForTransport(err).message }
    })
}

const runAllSync = async(): Promise<CookieSyncResult> => {
  const sources = COOKIE_SOURCES.filter(source => hasCookie(source) && isCookieRecognized(source))
  if (!sources.length) return { synced: false, listCount: 0, count: 0, message: 'no_cookie' }

  let listCount = 0
  let count = 0
  let okSources = 0
  let failedSources = 0
  const details: CookieSyncDetail[] = []
  await Promise.all(sources.map(async source => {
    let detail: CookieSyncDetail
    try {
      const result = await serializeSync(source, async() => syncSource(source, getCookie(source)))
      listCount += result.listCount
      count += result.count
      if (result.listCount > 0 || result.total === 0) okSources++
      if (result.failed > 0) failedSources++
      const success = result.failed === 0
      detail = { source, status: success ? 'success' : 'failed', listCount: result.listCount, count: result.count, ...(result.message ? { message: result.message } : {}) }
    } catch (err) {
      failedSources++
      console.warn(`[cookieSync] ${source} sync failed:`, err)
      detail = { source, status: 'failed', listCount: 0, count: 0, message: errorForTransport(err).message }
    }
    details.push(detail)
  }))
  return { synced: okSources > 0, listCount, count, error: failedSources > 0, details: details.sort((a, b) => COOKIE_SOURCES.indexOf(a.source) - COOKIE_SOURCES.indexOf(b.source)) }
}

// eslint-disable-next-line @typescript-eslint/promise-function-async
export const syncAllPlaylists = (): Promise<CookieSyncResult> => {
  if (syncTask) return Promise.resolve({ synced: false, listCount: 0, count: 0, message: 'syncing' })
  syncTask = runAllSync().finally(() => { syncTask = null })
  return syncTask
}

// eslint-disable-next-line @typescript-eslint/promise-function-async
export const syncWyPlaylists = (): Promise<CookieSyncResult> => syncAllPlaylists()

export const syncCookieListsOnStartup = async(): Promise<void> => {
  if (!isFavListSyncEnabled()) return
  try {
    const result = await syncAllPlaylists()
    if (result.error) {
      const failures = result.details?.filter(item => item.status === 'failed') ?? []
      showLoadError({ code: 'COOKIE_SYNC_FAILED', message: failures.map(item => `${SOURCE_NAME[item.source]}: ${item.message ?? 'sync failed'}`).join('\n') }, 'COOKIE_SYNC_FAILED')
    }
  } catch (err) {
    console.warn('[cookieSync] startup sync failed:', err)
    showLoadError(err, 'COOKIE_SYNC_FAILED')
  }
}
