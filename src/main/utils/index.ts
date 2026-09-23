import { encodePath, isUrl, isMac } from '@common/utils'
import migrateSetting from '@common/utils/migrateSetting'
import getStore from '@main/utils/store'
import { recoverCredentialCommit } from './credentials'
import { STORE_NAMES, URL_SCHEME_RXP } from '@common/constants'
import defaultSetting from '@common/defaultSetting'
import defaultHotKey from '@common/defaultHotKey'
import { migrateDataJson, migrateHotKey, migrateUserApi, parseDataFile } from './migrate'
import { nativeTheme, powerSaveBlocker } from 'electron'
import { joinPath } from '@common/utils/nodejs'
import themes from '@common/theme/index.json'

export const parseEnvParams = (argv = process.argv): { cmdParams: LX.CmdParams, deeplink: string | null } => {
  const cmdParams: LX.CmdParams = {}
  let deeplink = null
  const rx = /^-\w+/
  for (let param of argv) {
    if (URL_SCHEME_RXP.test(param)) {
      deeplink = param
    }

    if (!rx.test(param)) continue
    param = param.substring(1)
    let index = param.indexOf('=')
    if (index < 0) {
      cmdParams[param] = true
    } else {
      cmdParams[param.substring(0, index)] = param.substring(index + 1)
    }
  }
  return {
    cmdParams,
    deeplink,
  }
}

const primitiveType = ['string', 'boolean', 'number']
const checkPrimitiveType = (val: any): boolean => val === null || primitiveType.includes(typeof val)
// const handleMergeSetting = (defaultSetting: LX.AppSetting, currentSetting: Partial<LX.AppSetting>) => {
//   const updatedSettingKeys: Array<keyof LX.AppSetting> = []
//   for (const key of Object.keys(defaultSetting) as Array<keyof LX.AppSetting>) {
//     const currentValue: any = currentSetting[key]
//     const isPrimitive = checkPrimitiveType(currentValue)
//     // if (checkPrimitiveType(value)) {
//     if (!isPrimitive) continue
//     updatedSettingKeys.push(key)
//     // @ts-expect-error
//     defaultSetting[key] = currentValue
//     // } else {
//     //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
//     // }
//   }
//   return {
//     setting: defaultSetting,
//     updatedSettingKeys,
//   }
// }

export const mergeSetting = (originSetting: LX.AppSetting, targetSetting?: Partial<LX.AppSetting> | null): {
  setting: LX.AppSetting
  updatedSettingKeys: Array<keyof LX.AppSetting>
  updatedSetting: Partial<LX.AppSetting>
} => {
  let originSettingCopy: LX.AppSetting = { ...originSetting }
  // const defaultVersion = targetSettingCopy.version
  const updatedSettingKeys: Array<keyof LX.AppSetting> = []
  const updatedSetting: Partial<LX.AppSetting> = {}

  if (targetSetting) {
    const originSettingKeys = Object.keys(originSettingCopy)
    const targetSettingKeys = Object.keys(targetSetting)

    if (originSettingKeys.length > targetSettingKeys.length) {
      for (const key of targetSettingKeys as Array<keyof LX.AppSetting>) {
        const targetValue: any = targetSetting[key]
        const isPrimitive = checkPrimitiveType(targetValue)
        // if (checkPrimitiveType(value)) {
        if (!isPrimitive || targetValue == originSettingCopy[key] || originSettingCopy[key] === undefined) continue
        updatedSettingKeys.push(key)
        updatedSetting[key] = targetValue
        // @ts-expect-error
        originSettingCopy[key] = targetValue
        // } else {
        //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
        // }
      }
    } else {
      for (const key of originSettingKeys as Array<keyof LX.AppSetting>) {
        const targetValue: any = targetSetting[key]
        const isPrimitive = checkPrimitiveType(targetValue)
        // if (checkPrimitiveType(value)) {
        if (!isPrimitive || targetValue == originSettingCopy[key]) continue
        updatedSettingKeys.push(key)
        updatedSetting[key] = targetValue
        // @ts-expect-error
        originSettingCopy[key] = targetValue
        // } else {
        //   if (!isPrimitive && currentValue != undefined) handleMergeSetting(value, currentValue)
        // }
      }
    }
  }

  return {
    setting: originSettingCopy,
    updatedSettingKeys,
    updatedSetting,
  }
}

const applyInitSetting = (setting: LX.AppSetting) => {
  if (global.envParams.cmdParams.hidden && !setting['tray.enable']) {
    setting['tray.enable'] = true
  }
}

export const updateSetting = async(setting?: Partial<LX.AppSetting>, isInit: boolean = false) => {
  const electronStore_config = getStore(STORE_NAMES.APP_SETTINGS)

  if (isInit) {
    setting = setting ? migrateSetting(setting) : {}
    applyInitSetting(setting as LX.AppSetting)
  }
  const requested = { ...setting }
  let result: ReturnType<typeof mergeSetting>
  await electronStore_config.update(current => {
    result = mergeSetting(isInit ? { ...defaultSetting } : current.setting ?? global.lx.appSetting, requested)
    result.setting.version = defaultSetting.version
    return { version: result.setting.version, setting: result.setting }
  })
  return result!
}

/**
 * 初始化设置
 */
export const initSetting = async() => {
  await recoverCredentialCommit(global.lxDataPath)
  const electronStore_config = getStore(STORE_NAMES.APP_SETTINGS)

  let setting = electronStore_config.get<LX.AppSetting | undefined>('setting')

  // migrate setting
  if (!setting) {
    const config = await parseDataFile<{ setting?: any }>('config.json')
    if (config?.setting) setting = config.setting as LX.AppSetting
    await migrateUserApi()
    await migrateDataJson()
  }

  // console.log(setting)
  return updateSetting(setting, true)
}

/**
 * 初始化快捷键设置
 */
export const initHotKey = async() => {
  const electronStore_hotKey = getStore(STORE_NAMES.HOTKEY)

  let localConfig = electronStore_hotKey.get<LX.HotKeyConfig | null>('local')
  let globalConfig = electronStore_hotKey.get<LX.HotKeyConfig | null>('global')
  const hotKeyVersion = electronStore_hotKey.get<number>('version') ?? 0

  if (globalConfig) {
    // 移除v2.2.0及之前设置的全局媒体快捷键注册
    if (globalConfig.keys.MediaPlayPause) {
      delete globalConfig.keys.MediaPlayPause
      delete globalConfig.keys.MediaNextTrack
      delete globalConfig.keys.MediaPreviousTrack
    }
  } else {
    // migrate hotKey
    const config = await migrateHotKey()
    if (config) {
      localConfig = config.local
      globalConfig = config.global
    } else {
      localConfig = JSON.parse(JSON.stringify(defaultHotKey.local))
      globalConfig = JSON.parse(JSON.stringify(defaultHotKey.global))
    }
  }

  const resolvedLocalConfig: LX.HotKeyConfig = localConfig ?? JSON.parse(JSON.stringify(defaultHotKey.local))

  if (hotKeyVersion < 1) {
    const listSearchHotKey = defaultHotKey.local.keys['mod+f']
    if (!Object.values(resolvedLocalConfig.keys).some(info => info.action == listSearchHotKey.action) && !resolvedLocalConfig.keys['mod+f']) {
      resolvedLocalConfig.keys['mod+f'] = { ...listSearchHotKey }
    }
  }

  if (hotKeyVersion < 2) {
    const fullscreenHotKey = defaultHotKey.local.keys.f11
    const configs = [resolvedLocalConfig, globalConfig!]
    if (!configs.some(config => config.keys.f11 || Object.values(config.keys).some(info => info.action == fullscreenHotKey.action))) {
      resolvedLocalConfig.keys.f11 = { ...fullscreenHotKey }
    }
  }

  const config = { local: resolvedLocalConfig, global: globalConfig! }
  await electronStore_hotKey.update(current => ({ ...current, ...config, version: Math.max(hotKeyVersion, 2) }))
  return config
}

export const saveAppHotKeyConfig = async(config: LX.HotKeyConfigAll) => {
  const value = JSON.parse(JSON.stringify(config)) as LX.HotKeyConfigAll
  await getStore(STORE_NAMES.HOTKEY).update(current => ({ ...current, ...value }))
  Object.assign(global.lx.hotKey.config, value)
}

export const openDevTools = (webContents: Electron.WebContents) => {
  webContents.openDevTools({
    mode: 'undocked',
  })
}


let userThemes: LX.Theme[]
export const getAllThemes = () => {
  userThemes ??= getStore(STORE_NAMES.THEME).get<LX.Theme[] | null>('themes') ?? []
  return {
    themes,
    userThemes,
    dataPath: joinPath(global.lxDataPath, 'theme_images'),
  }
}

export const saveTheme = async(theme: LX.Theme) => {
  const storage = getStore(STORE_NAMES.THEME)
  const value = JSON.parse(JSON.stringify(theme)) as LX.Theme
  await storage.update(current => {
    const themes = (current.themes ?? []) as LX.Theme[]
    const index = themes.findIndex(item => item.id === value.id)
    if (index < 0) themes.push(value)
    else themes.splice(index, 1, value)
    return { ...current, themes }
  })
  userThemes = storage.get('themes')
}

export const removeTheme = async(id: string) => {
  const storage = getStore(STORE_NAMES.THEME)
  await storage.update(current => ({ ...current, themes: ((current.themes ?? []) as LX.Theme[]).filter(item => item.id !== id) }))
  userThemes = storage.get('themes')
}

const copyTheme = (theme: LX.Theme): LX.Theme => {
  return {
    ...theme,
    config: {
      ...theme.config,
      extInfo: { ...theme.config.extInfo },
      themeColors: { ...theme.config.themeColors },
    },
  }
}
export const getTheme = () => {
  // fs.promises.readdir()
  const shouldUseDarkColors = nativeTheme.shouldUseDarkColors
  let themeId = global.lx.appSetting['theme.id'] == 'auto'
    ? shouldUseDarkColors
      ? global.lx.appSetting['theme.darkId']
      : global.lx.appSetting['theme.lightId']
    : global.lx.appSetting['theme.id']
  // themeId = 'naruto'
  // themeId = 'pink'
  // themeId = 'black'
  let theme = themes.find(theme => theme.id == themeId)
  if (!theme) {
    userThemes = getStore(STORE_NAMES.THEME).get<LX.Theme[] | null>('themes') ?? []
    theme = userThemes.find(theme => theme.id == themeId)
    if (theme) {
      if (theme.config.extInfo['--background-image'] != 'none') {
        theme = copyTheme(theme)
        theme.config.extInfo['--background-image'] =
          isUrl(theme.config.extInfo['--background-image'])
            ? `url(${theme.config.extInfo['--background-image']})`
            : `url("${encodePath(joinPath(global.lxDataPath, 'theme_images', theme.config.extInfo['--background-image']))}")`
      }
    } else {
      themeId = global.lx.appSetting['theme.id'] == 'auto' && shouldUseDarkColors ? 'black' : 'green'
      theme = themes.find(theme => theme.id == themeId) as LX.Theme
    }
  }

  const colors: Record<string, string> = {
    ...theme.config.themeColors,
    ...theme.config.extInfo,
  }

  return {
    shouldUseDarkColors,
    theme: {
      id: global.lx.appSetting['theme.id'],
      name: theme.name,
      isDark: theme.isDark,
      isDarkFont: theme.isDarkFont,
      colors,
    },
  }
}

let powerSaveBlockerId: number | null = null
export const setPowerSaveBlocker = (enabled: boolean) => {
  let isEnabled = powerSaveBlockerId != null && powerSaveBlocker.isStarted(powerSaveBlockerId)
  if (enabled) {
    if (isEnabled) return
    powerSaveBlockerId = powerSaveBlocker.start(isMac ? 'prevent-display-sleep' : 'prevent-app-suspension')
  } else {
    if (!isEnabled) return
    powerSaveBlocker.stop(powerSaveBlockerId!)
    powerSaveBlockerId = null
  }
}


let envProxy: null | { host: string, port: number } = null
export const getProxy = () => {
  if (global.lx.appSetting['network.proxy.enable'] && global.lx.appSetting['network.proxy.host']) {
    return {
      host: global.lx.appSetting['network.proxy.host'],
      port: parseInt(global.lx.appSetting['network.proxy.port'] || '80'),
    }
  }
  if (envProxy) {
    return {
      host: envProxy.host,
      port: envProxy.port,
    }
  } else {
    const envProxyStr = envParams.cmdParams['proxy-server']
    if (envProxyStr && typeof envProxyStr == 'string') {
      const [host, port = ''] = envProxyStr.split(':')
      return envProxy = {
        host,
        port: parseInt(port || '80'),
      }
    }
  }

  return null
}
