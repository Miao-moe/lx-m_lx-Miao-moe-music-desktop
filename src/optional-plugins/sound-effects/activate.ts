import { watch } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import type { PluginContext } from '@common/optionalPluginTypes'
import { createSoundEffects } from './audio'
import { freqs } from './presetsData'

export default (context: PluginContext) => {
  let effects: ReturnType<typeof createSoundEffects> | null = null
  const stop = watch(() => Object.entries(appSetting).filter(([key]) => key.startsWith('player.soundEffect.')).map(([, value]) => value), () => {
    const active = appSetting['player.soundEffect.panner.enable'] || Boolean(appSetting['player.soundEffect.convolution.fileName']) ||
      appSetting['player.soundEffect.pitchShifter.playbackRate'] !== 1 || freqs.some(frequency => appSetting[`player.soundEffect.biquadFilter.hz${frequency}`] !== 0)
    if (active) {
      effects ??= createSoundEffects(context)
      effects.apply(appSetting)
    } else {
      effects?.dispose()
      effects = null
    }
  }, { immediate: true })
  return () => {
    stop()
    effects?.dispose()
    effects = null
  }
}
