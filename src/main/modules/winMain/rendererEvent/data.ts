import { DATA_KEYS, STORE_NAMES } from '@common/constants'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { mainOn, mainHandle } from '@common/mainIpc'
import getStore from '@main/utils/store'

export default () => {
  // Acknowledge durable storage before the renderer sends any platform writes.
  mainHandle<unknown>(WIN_MAIN_RENDERER_EVENT_NAME.playlist_writeback_save, async({ params }) => {
    await getStore(STORE_NAMES.DATA).set(DATA_KEYS.playlistWriteback, params)
  })
  mainHandle<string, any>(WIN_MAIN_RENDERER_EVENT_NAME.get_data, ({ params: path }) => {
    return getStore(STORE_NAMES.DATA).get(path) as any
  })

  mainOn<{
    path: string
    data: any
  }>(WIN_MAIN_RENDERER_EVENT_NAME.save_data, ({ params: { path, data } }) => {
    void getStore(STORE_NAMES.DATA).set(path, data)
  })
}
