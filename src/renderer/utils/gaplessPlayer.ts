import { appSetting } from '@renderer/store/setting'
import { playbackSession } from '@renderer/core/player/playbackSession'

type TransitionState = 'idle' | 'crossfading' | 'handoff'
type TransitionHandler = (url: string, isCurrentTransition: () => boolean) => boolean | Promise<boolean>
interface GaplessAudioOutput {
  attach: (audio: HTMLAudioElement) => () => void
  getVolume: (audio: HTMLAudioElement) => number
  setVolume: (audio: HTMLAudioElement, volume: number) => void
  getTargetVolume: () => number
}

const NO_FADE_LEAD_TIME = 80
const HANDOFF_FADE_TIME = 80
const HANDOFF_TIMEOUT = 15000
const PROGRESS_POLL_INTERVAL = 20
const PROGRESS_STALL_TIMEOUT = 500

let primaryAudio: HTMLAudioElement | null = null
let secondaryAudio: HTMLAudioElement | null = null
let transitionHandler: TransitionHandler | null = null
let nextSongUrl: string | null = null
let transitionState: TransitionState = 'idle'
let transitionId = 0
let transitionTimer: number | null = null
let volumeTimer: number | null = null
let handoffTimer: number | null = null
let primaryPlayRequested = false
let handoffAccepted = false
let primaryStartVolume = 1
let primaryAutoplay = true
let primaryBuffering = false
let lastPrimaryTime = 0
let audioOutput: GaplessAudioOutput | null = null
let releaseSecondaryOutput: (() => void) | undefined
let releaseSession: (() => void) | undefined
const getVolume = (audio: HTMLAudioElement) => audioOutput?.getVolume(audio) ?? audio.volume
const setVolume = (audio: HTMLAudioElement, volume: number) => {
  if (audioOutput) audioOutput.setVolume(audio, volume)
  else audio.volume = volume
}

const clearTimer = (timer: number | null) => {
  if (timer != null) window.clearTimeout(timer)
}

const clearTransitionTimer = () => {
  clearTimer(transitionTimer)
  transitionTimer = null
}

const clearVolumeTimer = () => {
  clearTimer(volumeTimer)
  volumeTimer = null
}

const clearHandoffTimer = () => {
  clearTimer(handoffTimer)
  handoffTimer = null
}

const resetSecondaryAudio = () => {
  if (!secondaryAudio) return
  secondaryAudio.pause()
  setVolume(secondaryAudio, 0)
  secondaryAudio.removeAttribute('src')
  secondaryAudio.load()
}

const restorePrimaryAudio = () => {
  if (!primaryAudio) return
  primaryAudio.autoplay = primaryAutoplay
  setVolume(primaryAudio, primaryStartVolume)
}

const finishTransition = () => {
  transitionId++
  const shouldRestorePrimary = transitionState !== 'idle'
  clearTransitionTimer()
  clearVolumeTimer()
  clearHandoffTimer()
  resetSecondaryAudio()
  if (shouldRestorePrimary) restorePrimaryAudio()
  nextSongUrl = null
  primaryPlayRequested = false
  handoffAccepted = false
  transitionState = 'idle'
}

export const cancelGaplessTransition = () => {
  finishTransition()
}

const runVolumeTransition = (duration: number, update: (progress: number) => void, complete: () => void) => {
  clearVolumeTimer()
  const startTime = Date.now()
  const tick = () => {
    const progress = Math.min(1, (Date.now() - startTime) / duration)
    update(progress)
    if (progress >= 1) {
      volumeTimer = null
      complete()
      return
    }
    volumeTimer = window.setTimeout(tick, 20)
  }
  tick()
}

const getFadeDuration = () => {
  if (!appSetting['player.fadeInFadeOut']) return NO_FADE_LEAD_TIME
  return Math.max(100, Math.min(3000, appSetting['player.fadeDuration'] ?? 800))
}

const getPlaybackRate = () => Math.max(0.1, primaryAudio?.playbackRate ?? 1)

// Fade settings use elapsed milliseconds; the media clock advances at playbackRate.
const getRemainingPlaybackTime = () => primaryAudio ? (primaryAudio.duration - primaryAudio.currentTime) / getPlaybackRate() * 1000 : Infinity

const canAdvancePrimary = () => primaryAudio && !primaryBuffering && !primaryAudio.paused && !primaryAudio.seeking && primaryAudio.readyState >= 3

const hasPrimaryEnded = () => primaryAudio && (primaryAudio.ended ||
  (Number.isFinite(primaryAudio.duration) && primaryAudio.duration > 0 && primaryAudio.currentTime >= primaryAudio.duration))

const getSecondaryTargetVolume = () => {
  if (audioOutput) return audioOutput.getTargetVolume()
  const volume = appSetting['player.volume'] * (appSetting['player.maxVolume'] ?? 1)
  return Math.max(0, Math.min(1, volume))
}

const handlePrimaryPlaying = () => {
  primaryBuffering = false
  lastPrimaryTime = primaryAudio?.currentTime ?? 0
  if (transitionState !== 'handoff' || !handoffAccepted || !primaryAudio || !secondaryAudio) return

  const targetPrimaryVolume = primaryStartVolume
  const startSecondaryVolume = getVolume(secondaryAudio)
  runVolumeTransition(HANDOFF_FADE_TIME, (progress) => {
    if (primaryAudio) setVolume(primaryAudio, targetPrimaryVolume * progress)
    if (secondaryAudio) setVolume(secondaryAudio, startSecondaryVolume * (1 - progress))
  }, finishTransition)
}

const handlePrimaryCanPlay = () => {
  if (transitionState !== 'handoff' || !handoffAccepted || primaryPlayRequested || !primaryAudio || !secondaryAudio) return
  const requestId = transitionId
  primaryPlayRequested = true
  setVolume(primaryAudio, 0)
  try {
    primaryAudio.currentTime = secondaryAudio.currentTime
  } catch {}
  void primaryAudio.play().catch((err) => {
    if (requestId !== transitionId) return
    console.warn('[gapless] primary audio handoff failed:', err)
    finishTransition()
  })
}

const commitTransition = async() => {
  // Switching tracks clears the timed-stop flag, so check it before the handoff.
  if (!playbackSession.canAdvance() || transitionState !== 'crossfading' || !primaryAudio || !nextSongUrl || !transitionHandler) {
    finishTransition()
    return
  }
  if (!hasPrimaryEnded()) {
    restartTransition()
    return
  }

  clearVolumeTimer()
  setVolume(primaryAudio, 0)
  if (secondaryAudio) setVolume(secondaryAudio, getSecondaryTargetVolume())
  const url = nextSongUrl
  const requestId = transitionId
  const isCurrentTransition = () => requestId === transitionId && transitionState === 'handoff'
  transitionState = 'handoff'
  primaryPlayRequested = false
  primaryAutoplay = primaryAudio.autoplay
  primaryAudio.autoplay = false

  handoffTimer = window.setTimeout(() => {
    console.warn('[gapless] primary audio handoff timed out')
    finishTransition()
    if (primaryAudio?.ended) window.app_event.playerEnded()
  }, HANDOFF_TIMEOUT)

  let accepted = false
  try {
    accepted = await transitionHandler(url, isCurrentTransition)
  } catch (err) {
    console.warn('[gapless] transition handler failed:', err)
  }
  if (!isCurrentTransition()) return
  if (!accepted) {
    finishTransition()
    if (primaryAudio.ended) window.app_event.playerEnded()
    return
  }
  handoffAccepted = true
}

const restartTransition = () => {
  const url = nextSongUrl
  finishTransition()
  if (url) setNextSongUrl(url)
}

const runCrossfade = () => {
  if (!primaryAudio) return
  const startTime = primaryAudio.currentTime
  let lastTime = startTime
  let lastProgressAt = Date.now()
  const targetSecondaryVolume = getSecondaryTargetVolume()
  const tick = () => {
    if (transitionState !== 'crossfading' || !primaryAudio || !secondaryAudio) return
    if (!playbackSession.canAdvance()) {
      finishTransition()
      return
    }
    const ended = hasPrimaryEnded()
    if (!ended && (!canAdvancePrimary() || !Number.isFinite(primaryAudio.duration) || primaryAudio.duration <= 0 || getRemainingPlaybackTime() > getFadeDuration())) {
      restartTransition()
      return
    }
    if (primaryAudio.currentTime > lastTime) {
      lastTime = primaryAudio.currentTime
      lastProgressAt = Date.now()
    } else if (!ended && Date.now() - lastProgressAt >= PROGRESS_STALL_TIMEOUT) {
      handlePrimaryWaiting()
      return
    }

    // Advance the fade only when the current track's media clock advances.
    const progress = ended ? 1 : Math.max(0, Math.min(1, (primaryAudio.currentTime - startTime) / (primaryAudio.duration - startTime)))
    setVolume(primaryAudio, appSetting['player.fadeInFadeOut'] ? primaryStartVolume * (1 - progress) : 0)
    setVolume(secondaryAudio, appSetting['player.fadeInFadeOut'] ? targetSecondaryVolume * progress : targetSecondaryVolume)
    if (ended) {
      volumeTimer = null
      void commitTransition()
      return
    }
    volumeTimer = window.setTimeout(tick, PROGRESS_POLL_INTERVAL)
  }
  tick()
}

const startCrossfade = async() => {
  clearTransitionTimer()
  if (transitionState !== 'idle' || !primaryAudio || !secondaryAudio || !nextSongUrl) return
  if (!appSetting['player.gaplessPlayback'] || !playbackSession.canAdvance()) return
  // A timeout is only a prediction; buffering may have stopped the media clock.
  if (!canAdvancePrimary() || !Number.isFinite(primaryAudio.duration) || getRemainingPlaybackTime() > getFadeDuration()) {
    scheduleTransition()
    return
  }

  const url = nextSongUrl
  const requestId = ++transitionId
  transitionState = 'crossfading'
  primaryStartVolume = getVolume(primaryAudio)
  primaryAutoplay = primaryAudio.autoplay
  secondaryAudio.currentTime = 0
  setVolume(secondaryAudio, 0)
  secondaryAudio.muted = appSetting['player.isMute']
  secondaryAudio.defaultPlaybackRate = primaryAudio.defaultPlaybackRate
  secondaryAudio.playbackRate = primaryAudio.playbackRate
  secondaryAudio.preservesPitch = primaryAudio.preservesPitch

  try {
    await secondaryAudio.play()
  } catch (err) {
    if (requestId !== transitionId) return
    console.warn('[gapless] secondary audio playback failed:', err)
    finishTransition()
    return
  }
  if (requestId !== transitionId || transitionState !== 'crossfading' || nextSongUrl !== url) return
  if (!playbackSession.canAdvance()) {
    finishTransition()
    return
  }

  runCrossfade()
}

const scheduleTransition = () => {
  clearTransitionTimer()
  if (transitionState !== 'idle' || !primaryAudio || !secondaryAudio || !nextSongUrl) return
  if (!appSetting['player.gaplessPlayback'] || !playbackSession.canAdvance() || !canAdvancePrimary()) return

  const duration = primaryAudio.duration
  if (!Number.isFinite(duration) || duration <= 0) return
  const remaining = getRemainingPlaybackTime()
  if (remaining <= 0) return

  const fadeDuration = getFadeDuration()
  const delay = remaining > fadeDuration ? Math.max(PROGRESS_POLL_INTERVAL, remaining - fadeDuration) : 0
  transitionTimer = window.setTimeout(() => {
    transitionTimer = null
    void startCrossfade()
  }, delay)
}

const handlePrimaryTimeUpdate = () => {
  if (primaryAudio) {
    if (primaryAudio.currentTime > lastPrimaryTime && primaryAudio.readyState >= 3 && !primaryAudio.paused && !primaryAudio.seeking) primaryBuffering = false
    lastPrimaryTime = primaryAudio.currentTime
  }
  if (transitionTimer == null) scheduleTransition()
}

const handlePrimaryWaiting = () => {
  primaryBuffering = true
  lastPrimaryTime = primaryAudio?.currentTime ?? 0
  clearTransitionTimer()
  if (transitionState === 'crossfading') restartTransition()
}

const handlePrimaryPause = () => {
  if (transitionState === 'crossfading') {
    window.setTimeout(() => {
      if (transitionState !== 'crossfading') return
      if (primaryAudio?.ended) void commitTransition()
      else finishTransition()
    })
  } else if (transitionState === 'idle') {
    clearTransitionTimer()
  }
}

const handlePrimaryEnded = () => {
  if (transitionState === 'crossfading') void commitTransition()
}

const handlePrimaryRateChange = () => {
  if (primaryAudio && secondaryAudio && transitionState !== 'idle') {
    secondaryAudio.defaultPlaybackRate = primaryAudio.defaultPlaybackRate
    secondaryAudio.playbackRate = primaryAudio.playbackRate
  }
  scheduleTransition()
}

const handlePrimarySeeking = () => {
  const url = transitionState === 'crossfading' || (transitionState === 'handoff' && !handoffAccepted) ? nextSongUrl : null
  if (url) {
    finishTransition()
    setNextSongUrl(url)
  } else {
    scheduleTransition()
  }
}

const handleSecondaryError = () => {
  if (transitionState !== 'idle') finishTransition()
  else {
    clearTransitionTimer()
    nextSongUrl = null
    resetSecondaryAudio()
  }
}

const createSecondaryAudio = () => {
  const audio = new Audio()
  audio.controls = false
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.autoplay = false
  audio.volume = 0
  audio.addEventListener('error', handleSecondaryError)
  secondaryAudio = audio
  releaseSecondaryOutput = audioOutput?.attach(audio)
}

export const initGaplessEngine = (mainAudio: HTMLAudioElement, onTransition: TransitionHandler, output?: GaplessAudioOutput) => {
  destroyGaplessEngine()
  primaryAudio = mainAudio
  lastPrimaryTime = mainAudio.currentTime
  transitionHandler = onTransition
  audioOutput = output ?? null
  createSecondaryAudio()
  releaseSession = playbackSession.subscribe(reason => {
    if (reason === 'pause' || reason === 'stop' || reason === 'timed-stop') finishTransition()
  })

  primaryAudio.addEventListener('timeupdate', handlePrimaryTimeUpdate)
  primaryAudio.addEventListener('playing', handlePrimaryPlaying)
  primaryAudio.addEventListener('playing', scheduleTransition)
  primaryAudio.addEventListener('waiting', handlePrimaryWaiting)
  primaryAudio.addEventListener('stalled', handlePrimaryWaiting)
  primaryAudio.addEventListener('pause', handlePrimaryPause)
  primaryAudio.addEventListener('ended', handlePrimaryEnded)
  primaryAudio.addEventListener('seeking', handlePrimarySeeking)
  primaryAudio.addEventListener('seeked', scheduleTransition)
  primaryAudio.addEventListener('durationchange', scheduleTransition)
  primaryAudio.addEventListener('ratechange', handlePrimaryRateChange)
  primaryAudio.addEventListener('canplay', handlePrimaryCanPlay)
}

export const setNextSongUrl = (url: string | null) => {
  if (!url) {
    if (transitionState !== 'handoff') finishTransition()
    return
  }
  if (!secondaryAudio || !primaryAudio) return
  if (nextSongUrl === url) {
    scheduleTransition()
    return
  }
  if (transitionState !== 'idle') finishTransition()

  nextSongUrl = url
  secondaryAudio.src = url
  secondaryAudio.load()
  if (typeof secondaryAudio.setSinkId === 'function') {
    void secondaryAudio.setSinkId(appSetting['player.mediaDeviceId']).catch((err) => {
      console.warn('[gapless] setting secondary output device failed:', err)
    })
  }
  scheduleTransition()
}

export const refreshGaplessTransition = () => {
  if (transitionState === 'idle') scheduleTransition()
}

export const setGaplessMuted = (muted: boolean) => {
  if (secondaryAudio) secondaryAudio.muted = muted
}

export const isGaplessTransitionActive = () => transitionState !== 'idle'

export const isGaplessHandoffActive = () => transitionState === 'handoff'

export const destroyGaplessEngine = () => {
  releaseSession?.()
  releaseSession = undefined
  finishTransition()
  if (primaryAudio) {
    primaryAudio.removeEventListener('timeupdate', handlePrimaryTimeUpdate)
    primaryAudio.removeEventListener('playing', handlePrimaryPlaying)
    primaryAudio.removeEventListener('playing', scheduleTransition)
    primaryAudio.removeEventListener('waiting', handlePrimaryWaiting)
    primaryAudio.removeEventListener('stalled', handlePrimaryWaiting)
    primaryAudio.removeEventListener('pause', handlePrimaryPause)
    primaryAudio.removeEventListener('ended', handlePrimaryEnded)
    primaryAudio.removeEventListener('seeking', handlePrimarySeeking)
    primaryAudio.removeEventListener('seeked', scheduleTransition)
    primaryAudio.removeEventListener('durationchange', scheduleTransition)
    primaryAudio.removeEventListener('ratechange', handlePrimaryRateChange)
    primaryAudio.removeEventListener('canplay', handlePrimaryCanPlay)
  }
  if (secondaryAudio) secondaryAudio.removeEventListener('error', handleSecondaryError)
  releaseSecondaryOutput?.()
  releaseSecondaryOutput = undefined
  audioOutput = null
  primaryAudio = null
  secondaryAudio = null
  transitionHandler = null
  primaryBuffering = false
  lastPrimaryTime = 0
}
