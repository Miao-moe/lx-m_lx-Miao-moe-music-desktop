import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'

const allowed = new Set(['getLibraryPreferences', 'saveLibraryPreferences', 'getListeningHistory', 'clearListeningHistory', 'recordListening', 'getDatabaseCacheSizes'])
export default () => {
  mainHandle<{ method: string, args: any[] }, unknown>(WIN_MAIN_RENDERER_EVENT_NAME.library_action, async({ params }) => {
    if (!params || !allowed.has(params.method) || !Array.isArray(params.args)) throw Object.assign(new Error('无效的曲库操作'), { code: 'LIBRARY_ACTION_INVALID' })
    const service = global.lx.worker.dbService as unknown as Record<string, (...args: any[]) => Promise<any>>
    return service[params.method](...params.args)
  })
}
