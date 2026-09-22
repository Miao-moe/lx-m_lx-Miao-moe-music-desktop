import { mainHandle, mainOn } from '@common/mainIpc'
import { CMMON_EVENT_NAME } from '@common/ipcNames'
import { getFonts } from '@main/utils/fontManage'
import path from 'node:path'
import { FontLibrary } from '@main/utils/customFonts'
import type { CustomFont, FontImport } from '@common/fonts'
import { ipcWindowRole } from '@main/utils/ipcPolicy'
import { credentialKeys } from '@common/sensitive'

// 公共操作事件（公共，只注册一次）
export default () => {
  const fonts = new FontLibrary(path.join(global.lxDataPath, 'fonts'))
  mainHandle(CMMON_EVENT_NAME.list_custom_fonts, async() => fonts.list())
  mainHandle<FontImport, CustomFont>(CMMON_EVENT_NAME.import_custom_font, async({ params }) => fonts.import(params))
  mainHandle<string, Awaited<ReturnType<FontLibrary['read']>>>(CMMON_EVENT_NAME.read_custom_font, async({ params }) => fonts.read(params))
  mainHandle<undefined, LX.AppSetting>(CMMON_EVENT_NAME.get_app_setting, async({ event }) => {
    return ipcWindowRole(event) === 'main' ? global.lx.appSetting : { ...global.lx.appSetting, ...Object.fromEntries([...credentialKeys].map(key => [key, ''])) }
  })
  mainHandle<Partial<LX.AppSetting>>(CMMON_EVENT_NAME.set_app_setting, async({ params: config }) => {
    await global.lx.event_app.update_config(config)
  })

  mainHandle<LX.EnvParams>(CMMON_EVENT_NAME.get_env_params, async() => {
    return global.envParams
  })

  mainOn(CMMON_EVENT_NAME.clear_env_params_deeplink, () => {
    global.envParams.deeplink = null
  })

  mainHandle<string[]>(CMMON_EVENT_NAME.get_system_fonts, async() => {
    return getFonts()
  })
}
