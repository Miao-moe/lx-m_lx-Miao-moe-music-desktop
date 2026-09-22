import { reactive } from '@common/utils/vueTools'
import { runWebDAV, getWebDAVLastResult } from '@renderer/utils/ipc'
import { appSetting } from './setting'
import { withDownloadListSync } from './download/action'
import { errorForTransport } from '@common/utils/errorMessage'
import { beginSync, finishSync } from './syncStatus'

export const webdav = reactive<{ busy: boolean, operation: LX.WebDAV.Operation | null, result: LX.WebDAV.Result | null }>({
  busy: false,
  operation: null,
  result: null,
})

export const initWebDAVStatus = async() => {
  const result = await getWebDAVLastResult()
  if (!webdav.busy && !webdav.result) webdav.result = result
}

export const runWebDAVAction = async(operation: LX.WebDAV.Operation) => {
  if (webdav.busy) return
  webdav.busy = true
  webdav.operation = operation
  const key = operation === 'test' ? 'webdav:test' : 'webdav'
  beginSync(key, operation === 'test' ? 'WebDAV 连接测试' : 'WebDAV')
  try {
    const applyDownloads = (operation == 'sync' || operation == 'download') && (appSetting['sync.webdav.downloadHistory'] || appSetting['sync.webdav.downloadTasks'])
    webdav.result = await (applyDownloads ? withDownloadListSync(async() => runWebDAV(operation)) : runWebDAV(operation))
  } catch (error) {
    webdav.result = {
      success: false,
      operation,
      time: Date.now(),
      uploaded: [],
      downloaded: [],
      error: error instanceof Error && error.message == 'downloads_running' ? 'downloads_running' : 'local_error',
      diagnostic: errorForTransport(error).message,
    }
  } finally {
    webdav.busy = false
    webdav.operation = null
    if (webdav.result) finishSync(key, webdav.result.success ? undefined : { code: `WEBDAV_${webdav.result.error?.toUpperCase()}`, message: webdav.result.diagnostic ?? window.i18n.t(`setting__sync_webdav_error_${webdav.result.error ?? 'local_error'}`) }, operation === 'test' ? undefined : webdav.result.lastSuccess)
  }
}
