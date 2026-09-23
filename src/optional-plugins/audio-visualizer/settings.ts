import { appSetting, saveMediaDeviceId, updateSetting } from '@renderer/store/setting'
import { setMediaDeviceId } from '@renderer/plugins/player'
import { dialog } from '@renderer/plugins/Dialog'

export const setVisualization = async(key: 'player.audioVisualization' | 'desktopLyric.audioVisualization', enabled: boolean) => {
  if (enabled && appSetting['player.mediaDeviceId'] !== 'default') {
    const confirmed = await dialog.confirm({
      message: window.i18n.t('setting__player_audio_visualization_tip'),
      cancelButtonText: window.i18n.t('cancel_button_text'),
      confirmButtonText: window.i18n.t('confirm_button_text'),
    })
    if (!confirmed) return false
    await setMediaDeviceId('default')
    saveMediaDeviceId('default')
  }
  await updateSetting({ [key]: enabled })
  return true
}
