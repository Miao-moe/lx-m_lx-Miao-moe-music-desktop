import { markRaw, onBeforeUnmount } from '@common/utils/vueTools'
import { onSyncAction, sendSyncAction } from '@renderer/utils/ipc'
import { sync } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import { SYNC_CODE } from '@common/constants_sync'
import { recordSync, syncStatuses } from '@renderer/store/syncStatus'
import { formatError } from '@common/utils/errorMessage'

export default () => {
  const handleSyncList = (event: LX.Sync.SyncMainWindowActions) => {
    if (event.action === 'server_status' || event.action === 'client_status') {
      const key = 'device:' + event.action
      const status = event.data
      const running = status.message === SYNC_CODE.connecting || status.message === 'Wait syncing...' || status.message === 'stoping...' || status.message.startsWith('Try reconnnect...')
      const failed = Boolean(status.message) && !running
      const successful = status.status && !status.message
      recordSync(key, {
        label: event.action === 'server_status' ? '设备同步服务' : '设备同步连接',
        state: running ? 'running' : failed ? 'failed' : successful ? 'success' : 'idle',
        time: Date.now(),
        lastSuccess: successful && syncStatuses[key]?.state !== 'success' ? Date.now() : syncStatuses[key]?.lastSuccess,
        error: failed ? formatError(new Error(status.message), '连接失败', 'DEVICE_SYNC_FAILED') : undefined,
      })
    }
    // console.log(event)
    switch (event.action) {
      case 'select_mode':
        sync.deviceName = event.data.deviceName
        sync.type = event.data.type
        sync.isShowSyncMode = true
        break
      case 'close_select_mode':
        sync.isShowSyncMode = false
        break
      case 'server_status':
        sync.server.status.status = event.data.status
        sync.server.status.message = event.data.message
        sync.server.status.address = markRaw(event.data.address)
        sync.server.status.code = event.data.code
        sync.server.status.devices = markRaw(event.data.devices)
        break
      case 'client_status':
        sync.client.status.status = event.data.status
        sync.client.status.message = event.data.message
        sync.client.status.address = markRaw(event.data.address)
        if (event.data.message == SYNC_CODE.missingAuthCode || event.data.message == SYNC_CODE.authFailed) {
          if (!sync.isShowAuthCodeModal) sync.isShowAuthCodeModal = true
        } else if (sync.isShowAuthCodeModal) sync.isShowAuthCodeModal = false
        break
    }
  }

  const rSyncAction = onSyncAction(({ params }) => {
    handleSyncList(params)
  })

  onBeforeUnmount(() => {
    rSyncAction()
  })

  return async() => {
    sync.enable = appSetting['sync.enable']
    sync.mode = appSetting['sync.mode']
    sync.server.port = appSetting['sync.server.port']
    sync.client.host = appSetting['sync.client.host']
    if (appSetting['sync.enable']) {
      switch (appSetting['sync.mode']) {
        case 'server':
          if (appSetting['sync.server.port']) {
            void sendSyncAction({
              action: 'enable_server',
              data: {
                enable: appSetting['sync.enable'],
                port: appSetting['sync.server.port'],
              },
            }).catch(err => {
              console.log(err)
            })
          }
          break
        case 'client':
          if (appSetting['sync.client.host']) {
            void sendSyncAction({
              action: 'enable_client',
              data: {
                enable: appSetting['sync.enable'],
                host: appSetting['sync.client.host'],
              },
            }).catch(err => {
              console.log(err)
            })
          }
          break
        default:
          break
      }
    }
  }
}
