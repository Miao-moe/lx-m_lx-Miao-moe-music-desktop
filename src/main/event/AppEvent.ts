import { EventEmitter } from 'events'

import { saveAppHotKeyConfig, updateSetting } from '@main/utils'
import type { BrowserWindow } from 'electron'
import { log } from '@common/utils'

export class Event extends EventEmitter {
  // closeAll() {
  //   this.emit(COMMON_EVENT_NAME.closeAll)
  // }
  // initSetting() {
  //   this.emit(COMMON_EVENT_NAME.initConfig)
  //   // this.configStatus(null)
  // }

  /**
   * 初始化APP
   */
  app_inited() {
    this.emit('app_inited')
  }

  /**
   * 已更新的配置
   * @param keys 已更新配置的key
   * @param setting 已更新配置
   */
  updated_config(keys: Array<keyof LX.AppSetting>, setting: Partial<LX.AppSetting>) {
    this.emit('updated_config', keys, setting)
  }

  /**
   * 更新配置
   * @param setting 新设置
   */
  // Keep the original promise so legacy callers can ignore it while the rejection is logged below.
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  update_config(setting: Partial<LX.AppSetting>) {
    const task = updateSetting(setting).then(({ setting: newSetting, updatedSettingKeys, updatedSetting }) => {
      this.config_committed(newSetting, updatedSettingKeys, updatedSetting)
    })
    void task.catch(error => { log.error(error) })
    return task
  }

  config_committed(setting: LX.AppSetting, keys: Array<keyof LX.AppSetting>, changed: Partial<LX.AppSetting>) {
    global.lx.appSetting = setting
    if (!keys.length) return
    // Listener failures must not turn a committed save into an apparent disk failure.
    try { this.emit('update_config', setting) } catch (error) { log.error(error) }
    try { this.updated_config(keys, changed) } catch (error) { log.error(error) }
  }

  system_theme_change(isDark: boolean) {
    this.emit('system_theme_change', isDark)
  }

  theme_change() {
    this.emit('theme_change')
  }

  deeplink(link: string) {
    this.emit('deeplink', link)
  }

  player_status(status: Partial<LX.Player.Status>) {
    for (const [key, value] of Object.entries(status)) {
      // @ts-expect-error
      global.lx.player_status[key] = value
    }
    this.emit('player_status', status)
  }

  hot_key_down(keyInfo: LX.HotKeyDownInfo) {
    this.emit('hot_key_down', keyInfo)
  }

  async hot_key_config_update(config: LX.HotKeyConfigAll) {
    await saveAppHotKeyConfig(config)
    this.emit('hot_key_config_update', config)
  }

  main_window_created(win: BrowserWindow) {
    this.emit('main_window_created', win)
  }

  main_window_ready_to_show() {
    this.emit('main_window_ready_to_show')
  }

  main_window_inited() {
    this.emit('main_window_inited')
  }

  main_window_show() {
    this.emit('main_window_show')
  }

  main_window_hide() {
    this.emit('main_window_hide')
  }

  main_window_focus() {
    this.emit('main_window_focus')
  }

  main_window_blur() {
    this.emit('main_window_blur')
  }

  main_window_close() {
    this.emit('main_window_close')
  }

  main_window_fullscreen(isFullscreen: boolean) {
    this.emit('main_window_fullscreen', isFullscreen)
  }

  desktop_lyric_window_created(win: BrowserWindow) {
    this.emit('desktop_lyric_window_created', win)
  }
}


type EventMethods = Omit<EventType, keyof EventEmitter>
declare class EventType extends Event {
  on<K extends keyof EventMethods>(event: K, listener: (...args: Parameters<EventMethods[K]>) => unknown): this
  once<K extends keyof EventMethods>(event: K, listener: (...args: Parameters<EventMethods[K]>) => unknown): this
  off<K extends keyof EventMethods>(event: K, listener: (...args: Parameters<EventMethods[K]>) => unknown): this
}

export type Type = Omit<EventType, keyof Omit<EventEmitter, 'on' | 'off' | 'once'>>
