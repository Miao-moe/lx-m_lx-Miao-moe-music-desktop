import { watch, onBeforeUnmount, toRaw } from '@common/utils/vueTools'
import { savePlayInfo } from '@renderer/utils/ipc'
import { playQueueList, playQueueRevision, playQueueSource, playMusicInfo, playInfo, playedList, playbackReady } from '@renderer/store/player/state'
import { playProgress } from '@renderer/store/player/playProgress'
import { appSetting } from '@renderer/store/setting'
import { createSavedPlayInfo } from '@renderer/core/player/queueSession'

export default () => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    clearTimeout(timer)
    timer = undefined
    if (!playbackReady.value) return
    const current: LX.Player.PlayMusicInfo | null = playMusicInfo.musicInfo ? { ...toRaw(playMusicInfo), musicInfo: toRaw(playMusicInfo.musicInfo) } : null
    savePlayInfo(createSavedPlayInfo(
      toRaw(playQueueList), current, playInfo.playerPlayIndex, playQueueSource.value, toRaw(playedList),
      appSetting['player.isSavePlayTime'] ? playProgress.nowPlayTime : 0, playProgress.maxPlayTime, playInfo.playIndex,
    ))
  }
  // Save completed queue edits immediately, even while playback is paused.
  watch([playbackReady, playQueueRevision, playQueueSource, () => playMusicInfo.musicInfo, () => playInfo.playerPlayIndex, () => playedList.length], save, { flush: 'post' })
  watch([() => playProgress.nowPlayTime, () => playProgress.maxPlayTime], () => {
    if (playbackReady.value && !timer) timer = setTimeout(save, 2000)
  })
  window.addEventListener('beforeunload', save)
  onBeforeUnmount(() => {
    save()
    window.removeEventListener('beforeunload', save)
  })
}
