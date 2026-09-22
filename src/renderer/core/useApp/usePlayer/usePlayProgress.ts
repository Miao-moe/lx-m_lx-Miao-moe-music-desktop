import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { formatPlayTime2, getRandom } from '@common/utils/common'
import { onTimeupdate, getCurrentTime, getDuration, getAudioElement, setCurrentTime, onVisibilityChange } from '@renderer/plugins/player'
import { playProgress, setNowPlayTime, setMaxplayTime } from '@renderer/store/player/playProgress'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
// import { getList } from '@renderer/store/utils'
import { appSetting } from '@renderer/store/setting'
import { playNext } from '@renderer/core/player'
import { updateListMusics } from '@renderer/store/list/action'
import { getBufferRecoveryPosition } from '@renderer/core/player/bufferRecovery'
import { playbackSession } from '@renderer/core/player/playbackSession'

export default () => {
  let restorePlayTime = 0
  const mediaBuffer: {
    timeout: NodeJS.Timeout | null
    playTime: number | null
    attempts: number
  } = {
    timeout: null,
    playTime: null,
    attempts: 0,
  }

  // const updateMusicInfo = useCommit('list', 'updateMusicInfo')

  const startBuffering = () => {
    if (mediaBuffer.timeout != null || !playMusicInfo.musicInfo || !playbackSession.canAdvance()) return
    const track = playMusicInfo.musicInfo
    mediaBuffer.timeout = setTimeout(() => {
      mediaBuffer.timeout = null
      if (!playbackSession.canAdvance() || track !== playMusicInfo.musicInfo) return
      const currentTime = getCurrentTime()
      mediaBuffer.playTime ??= currentTime
      if (++mediaBuffer.attempts >= 10) {
        clearBufferTimeout()
        if (appSetting['player.autoSkipOnError']) {
          void playNext(true)
        }
        return
      }
      const skipTime = getBufferRecoveryPosition(currentTime, getDuration() || playProgress.maxPlayTime, getRandom(3, 6))
      startBuffering()
      if (skipTime != null) setCurrentTime(skipTime)
    }, 3000)
  }
  const clearBufferTimeout = () => {
    if (mediaBuffer.timeout) clearTimeout(mediaBuffer.timeout)
    mediaBuffer.timeout = null
    mediaBuffer.playTime = null
    mediaBuffer.attempts = 0
  }

  const setProgress = (time: number, maxTime?: number) => {
    if (!musicInfo.id) return
    if (maxTime != null) setMaxplayTime(maxTime)
    console.log('setProgress', time, maxTime)
    restorePlayTime = time
    if (mediaBuffer.timeout != null || mediaBuffer.playTime != null) {
      clearBufferTimeout()
      mediaBuffer.playTime = time
      startBuffering()
    }
    setNowPlayTime(time)
    setCurrentTime(time)

    // if (!isPlay) audio.play()
  }

  const handlePause = () => {
    // `waiting` also emits the UI's pause event, although the media element is
    // still trying to play. Keep its origin and retry budget across those events.
    if (getAudioElement().paused || !playbackSession.canAdvance()) clearBufferTimeout()
  }

  const handleStop = () => {
    clearBufferTimeout()
    restorePlayTime = 0
    setNowPlayTime(0)
    setMaxplayTime(0)
  }

  const handleError = () => {
    restorePlayTime ||= mediaBuffer.playTime ?? getCurrentTime() // 记录出错前的播放时间
    clearBufferTimeout()
    console.log('handleError')
  }

  const handleLoadeddata = () => {
    setMaxplayTime(getDuration())

    if (playMusicInfo.musicInfo && 'source' in playMusicInfo.musicInfo && !playMusicInfo.musicInfo.interval) {
      // console.log(formatPlayTime2(playProgress.maxPlayTime))

      if (playMusicInfo.listId) {
        void updateListMusics([{
          id: playMusicInfo.listId,
          musicInfo: {
            ...playMusicInfo.musicInfo,
            interval: formatPlayTime2(playProgress.maxPlayTime),
          },
        }])
      }
    }
  }

  const handlePlaying = () => {
    const resumeTime = restorePlayTime || mediaBuffer.playTime
    clearBufferTimeout()
    restorePlayTime = 0
    if (resumeTime != null) setCurrentTime(resumeTime)
  }
  const handleWating = () => {
    startBuffering()
  }

  const handleEmpied = () => {
    clearBufferTimeout()
  }

  const handleSetPlayInfo = () => {
    // restorePlayTime = playProgress.nowPlayTime
    setCurrentTime(restorePlayTime = playProgress.nowPlayTime)
    // setMaxplayTime(playProgress.maxPlayTime)
    clearBufferTimeout()
  }

  watch(() => playProgress.nowPlayTime, (newValue, oldValue) => {
    if (Math.abs(newValue - oldValue) > 2) window.app_event.activePlayProgressTransition()
  })
  const unsubscribe = playbackSession.subscribe(reason => {
    if (reason !== 'queue') clearBufferTimeout()
  })

  // window.app_event.on('play', handlePlay)
  window.app_event.on('pause', handlePause)
  window.app_event.on('stop', handleStop)
  window.app_event.on('error', handleError)
  window.app_event.on('setProgress', setProgress)
  // window.app_event.on(eventPlayerNames.restorePlay, handleRestorePlay)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  const rOnTimeupdate = onTimeupdate(() => {
    setNowPlayTime(getCurrentTime())
  })

  let currentPlayTime = 0
  const rVisibilityChange = onVisibilityChange(() => {
    if (document.hidden) {
      currentPlayTime = playProgress.nowPlayTime
    } else {
      if (Math.abs(playProgress.nowPlayTime - currentPlayTime) > 2) {
        window.app_event.activePlayProgressTransition()
      }
    }
  })

  onBeforeUnmount(() => {
    unsubscribe()
    clearBufferTimeout()
    rOnTimeupdate()
    rVisibilityChange()
    // window.app_event.off('play', handlePlay)
    window.app_event.off('pause', handlePause)
    window.app_event.off('stop', handleStop)
    window.app_event.off('error', handleError)
    window.app_event.off('setProgress', setProgress)
    // window.app_event.off(eventPlayerNames.restorePlay, handleRestorePlay)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
