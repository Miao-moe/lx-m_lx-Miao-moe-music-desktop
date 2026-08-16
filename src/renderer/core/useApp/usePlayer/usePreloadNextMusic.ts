import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { onTimeupdate, getCurrentTime, getAudioElement } from '@renderer/plugins/player'
import { playProgress } from '@renderer/store/player/playProgress'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { getNextPlayMusicInfo, playPreloadedNext, resetRandomNextMusicInfo } from '@renderer/core/player'
import { getMusicUrl } from '@renderer/core/music'
import { appSetting } from '@renderer/store/setting'
import {
  cancelGaplessTransition,
  destroyGaplessEngine,
  initGaplessEngine,
  isGaplessHandoffActive,
  refreshGaplessTransition,
  setGaplessMuted,
  setNextSongUrl,
} from '@renderer/utils/gaplessPlayer'
import { reportPlayHistory } from '@renderer/utils/playHistoryReporter'

let audio: HTMLAudioElement
const initAudio = () => {
  if (audio) return
  audio = new Audio()
  audio.controls = false
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.muted = true
  audio.volume = 0
  audio.autoplay = false
}

const checkMusicUrl = async(url: string): Promise<boolean> => {
  if (!url) return false
  initAudio()
  return new Promise((resolve) => {
    let timeout = 0
    const clear = () => {
      window.clearTimeout(timeout)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('canplay', handleCanPlay)
    }
    const finish = (result: boolean) => {
      clear()
      resolve(result)
    }
    const handleError = () => {
      finish(false)
    }
    const handleCanPlay = () => {
      finish(true)
    }
    timeout = window.setTimeout(() => {
      finish(false)
    }, 8000)
    audio.addEventListener('error', handleError)
    audio.addEventListener('canplay', handleCanPlay)
    audio.src = url
    audio.load()
  })
}

const getAvailableMusicUrl = async(info: LX.Player.PlayMusicInfo) => {
  const url = await getMusicUrl({ musicInfo: info.musicInfo }).catch(() => '')
  if (await checkMusicUrl(url)) return url

  const refreshedUrl = await getMusicUrl({ musicInfo: info.musicInfo, isRefresh: true }).catch(() => '')
  return await checkMusicUrl(refreshedUrl) ? refreshedUrl : ''
}

const preloadMusicInfo = {
  isLoading: false,
  preProgress: 0,
  requestId: 0,
  currentMusicId: null as string | null,
  info: null as LX.Player.PlayMusicInfo | null,
  url: '',
}

const resetPreloadInfo = () => {
  preloadMusicInfo.requestId++
  preloadMusicInfo.preProgress = 0
  preloadMusicInfo.currentMusicId = null
  preloadMusicInfo.info = null
  preloadMusicInfo.url = ''
  preloadMusicInfo.isLoading = false
}

const preloadNextMusicUrl = async(curTime: number) => {
  if (preloadMusicInfo.isLoading || curTime - preloadMusicInfo.preProgress < 3) return
  const currentMusicId = musicInfo.id
  if (!currentMusicId) return

  const requestId = ++preloadMusicInfo.requestId
  preloadMusicInfo.isLoading = true
  preloadMusicInfo.preProgress = curTime
  const info = await getNextPlayMusicInfo()
  if (!info || requestId !== preloadMusicInfo.requestId || musicInfo.id !== currentMusicId) {
    if (requestId === preloadMusicInfo.requestId) preloadMusicInfo.isLoading = false
    return
  }

  const url = await getAvailableMusicUrl(info)
  if (requestId !== preloadMusicInfo.requestId || musicInfo.id !== currentMusicId) return

  preloadMusicInfo.isLoading = false
  if (!url) return
  preloadMusicInfo.currentMusicId = currentMusicId
  preloadMusicInfo.info = info
  preloadMusicInfo.url = url
  if (appSetting['player.gaplessPlayback']) setNextSongUrl(url)
}

export default () => {
  initGaplessEngine(getAudioElement(), (url) => {
    const info = preloadMusicInfo.info
    if (!info || preloadMusicInfo.url !== url || preloadMusicInfo.currentMusicId !== musicInfo.id) return false
    if (musicInfo.id) void reportPlayHistory(musicInfo.id)
    return playPreloadedNext(info, url)
  })

  const setProgress = (time: number) => {
    if (!musicInfo.id) return
    preloadMusicInfo.preProgress = time
  }

  const handleSetPlayInfo = () => {
    const isExpectedHandoff = isGaplessHandoffActive() && preloadMusicInfo.info?.musicInfo.id === playMusicInfo.musicInfo?.id
    resetPreloadInfo()
    if (!isExpectedHandoff) cancelGaplessTransition()
  }

  watch(() => appSetting['player.togglePlayMethod'], () => {
    if (preloadMusicInfo.info && !preloadMusicInfo.info.isTempPlay) resetRandomNextMusicInfo()
    resetPreloadInfo()
    cancelGaplessTransition()
  })
  watch(() => appSetting['player.gaplessPlayback'], (enabled) => {
    if (enabled && preloadMusicInfo.url) setNextSongUrl(preloadMusicInfo.url)
    else if (!enabled) cancelGaplessTransition()
  })
  watch(() => appSetting['player.isMute'], setGaplessMuted)
  watch([
    () => appSetting['player.fadeInFadeOut'],
    () => appSetting['player.fadeDuration'],
  ], refreshGaplessTransition)

  window.app_event.on('setProgress', setProgress)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  const rOnTimeupdate = onTimeupdate(() => {
    const time = getCurrentTime()
    const duration = playProgress.maxPlayTime
    if (duration > 10 && duration - time < 10 && !preloadMusicInfo.info) {
      void preloadNextMusicUrl(time)
    }
  })

  onBeforeUnmount(() => {
    rOnTimeupdate()
    resetPreloadInfo()
    destroyGaplessEngine()
    window.app_event.off('setProgress', setProgress)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
