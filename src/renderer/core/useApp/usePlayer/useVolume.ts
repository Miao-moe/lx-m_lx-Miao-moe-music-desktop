import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { setVolume as setPlayerVolume, setMute as setPlayerMute } from '@renderer/plugins/player'

import { debounce } from '@common/utils'
import { HOTKEY_PLAYER } from '@common/hotKey'
// import { player as eventPlayerNames } from '@renderer/event/names'
import { volume, isMute, setMute, setVolume } from '@renderer/store/player/volume'
import { appSetting, saveVolume, saveVolumeIsMute } from '@renderer/store/setting'

export default () => {
  const handleSaveVolume = debounce(saveVolume, 300)

  const initialMax = appSetting['player.maxVolume'] ?? 1
  let lastMaxVolume = initialMax

  setVolume(appSetting['player.volume'])
  setMute(appSetting['player.isMute'])
  setPlayerVolume(appSetting['player.volume'] * initialMax)
  setPlayerMute(appSetting['player.isMute'])

  const handleToggleVolumeMute = (_isMute?: boolean) => {
    let muteStatus = _isMute ?? !isMute.value
    saveVolumeIsMute(muteStatus)
    setMute(muteStatus)
  }

  const handleSetVolume = (num: number) => {
    const max = appSetting['player.maxVolume'] ?? 1
    const _volume = num < 0 ? 0 : num > 1 ? 1 : num
    setVolume(_volume)
    setPlayerVolume(_volume * max)
  }

  const handleSetVolumeUp = (step = 0.04) => {
    handleSetVolume(volume.value + step)
  }
  const handleSetVolumeDown = (step = 0.04) => {
    handleSetVolume(volume.value - step)
  }

  const hotkeyVolumeUp = () => {
    handleSetVolumeUp()
  }
  const hotkeyVolumeDown = () => {
    handleSetVolumeDown()
  }
  const hotkeyVolumeMute = () => {
    handleToggleVolumeMute()
  }

  watch(volume, _volume => {
    handleSaveVolume(_volume)
    setPlayerVolume(_volume * (appSetting['player.maxVolume'] ?? 1))
  })
  watch(isMute, mute => {
    saveVolumeIsMute(mute)
    setPlayerMute(mute)
  })
  watch(() => appSetting['player.volume'], _volume => {
    setVolume(_volume)
    setPlayerVolume(_volume * (appSetting['player.maxVolume'] ?? 1))
  })
  watch(() => appSetting['player.isMute'], muteStatus => {
    setMute(muteStatus)
  })
  watch(() => appSetting['player.maxVolume'], (newMax) => {
    const max = newMax ?? 1
    const actual = volume.value * lastMaxVolume
    const newVolume = Math.min(1, Math.max(0, actual / max))
    lastMaxVolume = max
    setVolume(newVolume)
    handleSaveVolume(newVolume)
    setPlayerVolume(newVolume * max)
  })


  window.key_event.on(HOTKEY_PLAYER.volume_up.action, hotkeyVolumeUp)
  window.key_event.on(HOTKEY_PLAYER.volume_down.action, hotkeyVolumeDown)
  window.key_event.on(HOTKEY_PLAYER.volume_mute.action, hotkeyVolumeMute)
  window.app_event.on('setVolume', handleSetVolume)
  window.app_event.on('setVolumeIsMute', handleToggleVolumeMute)

  onBeforeUnmount(() => {
    window.key_event.off(HOTKEY_PLAYER.volume_up.action, hotkeyVolumeUp)
    window.key_event.off(HOTKEY_PLAYER.volume_down.action, hotkeyVolumeDown)
    window.key_event.off(HOTKEY_PLAYER.volume_mute.action, hotkeyVolumeMute)
    window.app_event.off('setVolume', handleSetVolume)
    window.app_event.off('setVolumeIsMute', handleToggleVolumeMute)
  })
}
