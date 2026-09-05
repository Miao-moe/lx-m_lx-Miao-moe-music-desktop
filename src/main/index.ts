import { app, dialog } from 'electron'
import './utils/logInit'
import '@common/error'
import {
  initGlobalData,
  initSingleInstanceHandle,
  applyElectronEnvParams,
  prepareUserData,
  setUserDataPath,
  registerDeeplink,
  listenerAppEvent,
} from './app'
import { isLinux } from '@common/utils'
import { APP_NAME } from '@common/constants'
import { initAppSetting } from '@main/app'
import registerModules from '@main/modules'

// 初始化应用
let startupPromise: Promise<void> | null = null
const init = () => {
  if (startupPromise) return
  console.log('init')
  startupPromise = prepareUserData()
    .then(initAppSetting)
    .then(() => {
      registerModules()
      global.lx.event_app.app_inited()
    }).catch((error: unknown) => {
      console.error('initialize user data failed:', error)
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox(APP_NAME, `应用数据初始化失败，原数据未被修改。\n\n${message}`)
      app.quit()
    }).finally(() => {
      startupPromise = null
    })
}

initGlobalData()
setUserDataPath()
initSingleInstanceHandle()
applyElectronEnvParams()
registerDeeplink(init)
listenerAppEvent(init)


// https://github.com/electron/electron/issues/16809
void app.whenReady().then(() => {
  isLinux ? setTimeout(init, 300) : init()
})
