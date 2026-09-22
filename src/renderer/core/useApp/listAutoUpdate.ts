import { getListUpdateInfo } from '@renderer/utils/data'
import { userLists } from '@renderer/store/list/state'
import syncSourceList from '@renderer/store/list/syncSourceList'
import { beginSync, progressSync, finishSync } from '@renderer/store/syncStatus'
import { showLoadError } from '@common/loadErrorNotice'

export const updatePlatformLists = async() => {
  beginSync('platform-auto', '平台歌单自动更新')
  try {
    const info = await getListUpdateInfo()
    const lists = userLists.filter(list => info[list.id]?.isAutoUpdate && list.source && list.sourceListId)
    let completed = 0
    const results = await Promise.allSettled(lists.map(async list => {
      try { await syncSourceList(list) } finally { progressSync('platform-auto', ++completed, lists.length) }
    }))
    const failures = results.filter(result => result.status === 'rejected')
    finishSync('platform-auto', failures.length ? { code: 'PLAYLIST_SYNC_PARTIAL', message: `${failures.length} / ${lists.length} 个歌单更新失败，详情见同步状态` } : undefined)
    if (failures.length) showLoadError({ code: 'PLAYLIST_SYNC_PARTIAL', message: `${failures.length} 个歌单更新失败，可在设置 → 数据同步 → 同步状态中查看原因和重试` })
    return results
  } catch (error) { finishSync('platform-auto', error); showLoadError(error, 'PLAYLIST_SYNC_FAILED'); return [] }
}
export default () => { void updatePlatformLists() }
