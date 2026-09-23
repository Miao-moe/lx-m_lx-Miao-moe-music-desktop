import { watch, onBeforeUnmount } from '@common/utils/vueTools'
import { setVolumeNormalization } from '@renderer/plugins/player'
import { appSetting, updateSetting } from '@renderer/store/setting'
import toast from '@renderer/plugins/Toast'

export default () => {
  let request = 0
  watch(() => appSetting['player.volumeNormalization'], enabled => {
    const current = ++request
    const handleError = (error: unknown) => {
      if (current !== request) return
      console.error('Volume normalization could not start:', error)
      void updateSetting({ 'player.volumeNormalization': false })
      toast(window.i18n.t('setting__play_volume_normalization_error'))
    }
    void setVolumeNormalization(enabled, handleError).catch(handleError)
  }, { immediate: true })
  onBeforeUnmount(() => {
    request++
    void setVolumeNormalization(false)
  })
}
