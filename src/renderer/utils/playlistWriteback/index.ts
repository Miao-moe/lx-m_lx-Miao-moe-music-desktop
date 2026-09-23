import { reactive } from '@common/utils/vueTools'
import { DATA_KEYS } from '@common/constants'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { rendererInvoke } from '@common/rendererIpc'
import { getListMusics } from '@renderer/store/list/listManage/rendererListManage'
import { userLists } from '@renderer/store/list/listManage/state'
import { withLocalListLocks } from '@renderer/store/list/localMutationLock'
import { createWritebackEngine } from './engine'
import { openRemotePlaylist } from './api'
import { localPlaylistSnapshot } from './snapshot'
import type { SavedState, Status } from './types'
import { recordSync } from '@renderer/store/syncStatus'
import { formatError } from '@common/utils/errorMessage'

export { isWritebackSupported } from './snapshot'
export { WritebackError } from './types'
export const writebackStatus = reactive<Record<string, Status>>({})

const engine = createWritebackEngine({
  load: async() => rendererInvoke<string, SavedState | null>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, DATA_KEYS.playlistWriteback),
  save: async state => rendererInvoke(WIN_MAIN_RENDERER_EVENT_NAME.playlist_writeback_save, state),
  local: async id => {
    const list = userLists.find(list => list.id === id)
    if (!list) return null
    return localPlaylistSnapshot(list, await getListMusics(id))
  },
  open: openRemotePlaylist,
  status: (id, status) => {
    writebackStatus[id] = status
    recordSync('writeback:' + id, {
      label: `${userLists.find(list => list.id === id)?.name ?? id} · 歌单回写`,
      state: status.state === 'syncing' || status.state === 'pending' ? 'running' : status.state,
      time: Date.now(),
      lastSuccess: status.lastSuccess,
      error: status.error ? formatError({ code: `WRITEBACK_${status.error.toUpperCase()}`, message: window.i18n.t(`list_writeback__error_${status.error}`) }, status.diagnostic) : undefined,
    })
  },
  lockLocal: async(id, task) => withLocalListLocks([id], task),
})

export const initPlaylistWriteback = engine.init
export const setPlaylistWriteback = engine.setEnabled
export const retryPlaylistWriteback = engine.run
export const refreshBoundPlaylist = engine.refresh
export const startPlaylistWriteback = engine.start
export const disposePlaylistWriteback = engine.dispose
export const notifyPlaylistChanged = (ids: string[], reset = false) => {
  void engine.changed(ids, reset).catch(() => {
    for (const id of ids) writebackStatus[id] = { enabled: !!writebackStatus[id]?.enabled, state: 'failed', error: 'storage' }
  })
}
