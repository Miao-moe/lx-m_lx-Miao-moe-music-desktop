import { formatError } from '@common/utils/errorMessage'
import { onBeforeUnmount } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { musicInfo, playMusicInfo } from '@renderer/store/player/state'
import { setStop, isEmpty } from '@renderer/plugins/player'
import { loadPendingTrackMetadata, playNext, setMusicUrl } from '@renderer/core/player'
import { getLastTryQuality, getNextTryQuality } from '@renderer/core/music/utils'
import { removeMusicUrl } from '@renderer/utils/ipc'
import { setAllStatus } from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { playbackSession } from '@renderer/core/player/playbackSession'
import { libraryError, recordListening } from '@renderer/utils/library'

export default () => {
  const t = useI18n()
  let retryNum = 0
  let prevTimeoutId: string | null = null
  let recordedId = ''

  let loadingTimeout: NodeJS.Timeout | null = null
  let delayNextTimeout: NodeJS.Timeout | null = null
  const startLoadingTimeout = () => {
    // console.log('start load timeout')
    clearLoadingTimeout()
    const token = playbackSession.capture()
    loadingTimeout = setTimeout(() => {
      loadingTimeout = null
      if (!playbackSession.isCurrent(token) || !playbackSession.canAdvance()) return
      if (window.lx.isPlayedStop) {
        prevTimeoutId = null
        setAllStatus('')
        return
      }

      // 如果加载超时，则尝试刷新URL
      if (prevTimeoutId == musicInfo.id) {
        prevTimeoutId = null
        void playNext(true)
      } else {
        prevTimeoutId = musicInfo.id
        if (playMusicInfo.musicInfo) setMusicUrl(playMusicInfo.musicInfo, true)
      }
    }, 25000)
  }
  const clearLoadingTimeout = () => {
    if (!loadingTimeout) return
    // console.log('clear load timeout')
    clearTimeout(loadingTimeout)
    loadingTimeout = null
  }

  const clearDelayNextTimeout = () => {
    // console.log(this.delayNextTimeout)
    if (!delayNextTimeout) return
    clearTimeout(delayNextTimeout)
    delayNextTimeout = null
  }
  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    const token = playbackSession.capture()
    delayNextTimeout = setTimeout(() => {
      delayNextTimeout = null
      if (!playbackSession.isCurrent(token) || !playbackSession.canAdvance()) return
      if (window.lx.isPlayedStop) {
        setAllStatus('')
        return
      }
      void playNext(true)
    }, 5000)
  }

  const handleLoadstart = () => {
    if (window.lx.isPlayedStop) return
    if (appSetting['player.autoSkipOnError']) startLoadingTimeout()
    setAllStatus(t('player__loading'))
  }

  const handleLoadeddata = () => {
    setAllStatus(t('player__loading'))
  }

  const handlePlaying = () => {
    setAllStatus('')
    clearLoadingTimeout()
    loadPendingTrackMetadata()
    const playing = playMusicInfo.musicInfo
    const song = playing && ('progress' in playing ? playing.metadata.musicInfo : playing)
    if (song && recordedId !== song.id) {
      recordedId = song.id
      void recordListening(song).catch(error => { libraryError.value = formatError(error, '保存听歌记录失败') })
    }
  }

  const handleEmpied = () => {
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }

  const handleWating = () => {
    setAllStatus(t('player__buffering'))
  }

  const handleError = (errCode?: number) => {
    if (!musicInfo.id) return
    clearLoadingTimeout()
    if (window.lx.isPlayedStop) return
    if (!isEmpty()) setStop()
    if (playMusicInfo.musicInfo && errCode !== 1) {
      const currentMusicInfo = playMusicInfo.musicInfo
      // 高音质 URL 可能返回无法解码的加密内容，逐级降低音质重试
      if (!('progress' in currentMusicInfo) && currentMusicInfo.source != 'local') {
        const urlSourceInfo = currentMusicInfo.meta.toggleMusicInfo ?? currentMusicInfo
        const lastQuality = getLastTryQuality(urlSourceInfo.id) ?? getLastTryQuality(currentMusicInfo.id)
        const nextQuality = getNextTryQuality(appSetting['player.playQuality'], urlSourceInfo, lastQuality)
        if (nextQuality) {
          if (lastQuality) {
            void removeMusicUrl(urlSourceInfo, lastQuality)
            if (urlSourceInfo != currentMusicInfo) void removeMusicUrl(currentMusicInfo, lastQuality)
          }
          setMusicUrl(currentMusicInfo, true, nextQuality)
          setAllStatus(t('player__refresh_url'))
          return
        }
      }
      if (retryNum < 2) { // 若音频URL无效则尝试刷新2次URL
        // console.log(this.retryNum)
        retryNum++
        setMusicUrl(currentMusicInfo, true)
        setAllStatus(t('player__refresh_url'))
        return
      }
    }

    setAllStatus(formatError({ code: errCode ? `MEDIA_${errCode}` : 'AUDIO_LOAD_FAILED' }, t('player__error')))
    if (appSetting['player.autoSkipOnError']) {
      if (document.hidden) {
        console.warn('error skip to next')
        void playNext(true)
      } else {
        const token = playbackSession.capture()
        setTimeout(() => { if (playbackSession.isCurrent(token) && playbackSession.canAdvance()) addDelayNextTimeout() })
      }
    }
  }

  const handleSetPlayInfo = () => {
    recordedId = ''
    retryNum = 0
    prevTimeoutId = null
    clearDelayNextTimeout()
    clearLoadingTimeout()
  }
  const unsubscribe = playbackSession.subscribe(reason => {
    if (reason !== 'queue') handleEmpied()
  })

  // const handlePlayedStop = () => {
  //   clearDelayNextTimeout()
  //   clearLoadingTimeout()
  // }


  window.app_event.on('playerLoadstart', handleLoadstart)
  window.app_event.on('playerLoadeddata', handleLoadeddata)
  window.app_event.on('playerPlaying', handlePlaying)
  window.app_event.on('playerWaiting', handleWating)
  window.app_event.on('playerEmptied', handleEmpied)
  window.app_event.on('playerError', handleError)
  window.app_event.on('musicToggled', handleSetPlayInfo)

  onBeforeUnmount(() => {
    unsubscribe()
    handleEmpied()
    window.app_event.off('playerLoadstart', handleLoadstart)
    window.app_event.off('playerLoadeddata', handleLoadeddata)
    window.app_event.off('playerPlaying', handlePlaying)
    window.app_event.off('playerWaiting', handleWating)
    window.app_event.off('playerEmptied', handleEmpied)
    window.app_event.off('playerError', handleError)
    window.app_event.off('musicToggled', handleSetPlayInfo)
  })
}
