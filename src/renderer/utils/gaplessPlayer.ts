import { appSetting } from '@renderer/store/setting'

type TransitionState = 'idle' | 'crossfading' | 'handoff'
type TransitionHandler = (url: string) => boolean

const NO_FADE_LEAD_TIME = 80
const HANDOFF_FADE_TIME = 80
const HANDOFF_TIMEOUT = 15000

let primaryAudio: HTMLAudioElement | null = null
let secondaryAudio: HTMLAudioElement | null = null
let transitionHandler: TransitionHandler | null = null
let nextSongUrl: string | null = null
let transitionState: TransitionState = 'idle'
let transitionTimer: number | null = null
let volumeTimer: number | null = null
let handoffTimer: number | null = null
let primaryPlayRequested = false
let primaryStartVolume = 1
let primaryAutoplay = true

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
  secondaryAudio.volume = 0
  secondaryAudio.removeAttribute('src')
  secondaryAudio.load()
}

const restorePrimaryAudio = () => {
  if (!primaryAudio) return
  primaryAudio.autoplay = primaryAutoplay
  primaryAudio.volume = primaryStartVolume
}

const finishTransition = () => {
  const shouldRestorePrimary = transitionState !== 'idle'
  clearTransitionTimer()
  clearVolumeTimer()
  clearHandoffTimer()
  resetSecondaryAudio()
  if (shouldRestorePrimary) restorePrimaryAudio()
  nextSongUrl = null
  primaryPlayRequested = false
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

const getSecondaryTargetVolume = () => {
  const volume = appSetting['player.volume'] * (appSetting['player.maxVolume'] ?? 1)
  return Math.max(0, Math.min(1, volume))
}

const handlePrimaryPlaying = () => {
  if (transitionState !== 'handoff' || !primaryAudio || !secondaryAudio) return

  const targetPrimaryVolume = primaryStartVolume
  const startSecondaryVolume = secondaryAudio.volume
  runVolumeTransition(HANDOFF_FADE_TIME, (progress) => {
    if (primaryAudio) primaryAudio.volume = targetPrimaryVolume * progress
    if (secondaryAudio) secondaryAudio.volume = startSecondaryVolume * (1 - progress)
  }, finishTransition)
}

const handlePrimaryCanPlay = () => {
  if (transitionState !== 'handoff' || primaryPlayRequested || !primaryAudio || !secondaryAudio) return
  primaryPlayRequested = true
  primaryAudio.volume = 0
  try {
    primaryAudio.currentTime = secondaryAudio.currentTime
  } catch {}
  void primaryAudio.play().catch((err) => {
    console.warn('[gapless] primary audio handoff failed:', err)
    finishTransition()
  })
}

const commitTransition = () => {
  if (transitionState !== 'crossfading' || !primaryAudio || !nextSongUrl || !transitionHandler) {
    finishTransition()
    return
  }

  clearVolumeTimer()
  primaryAudio.volume = 0
  if (secondaryAudio) secondaryAudio.volume = getSecondaryTargetVolume()
  const url = nextSongUrl
  transitionState = 'handoff'
  primaryPlayRequested = false
  primaryAutoplay = primaryAudio.autoplay
  primaryAudio.autoplay = false

  let accepted = false
  try {
    accepted = transitionHandler(url)
  } catch (err) {
    console.warn('[gapless] transition handler failed:', err)
  }
  if (!accepted) {
    finishTransition()
    return
  }

  handoffTimer = window.setTimeout(() => {
    console.warn('[gapless] primary audio handoff timed out')
    finishTransition()
  }, HANDOFF_TIMEOUT)
}

const startCrossfade = async() => {
  clearTransitionTimer()
  if (transitionState !== 'idle' || !primaryAudio || !secondaryAudio || !nextSongUrl) return
  if (!appSetting['player.gaplessPlayback']) return

  const url = nextSongUrl
  transitionState = 'crossfading'
  primaryStartVolume = primaryAudio.volume
  primaryAutoplay = primaryAudio.autoplay
  secondaryAudio.currentTime = 0
  secondaryAudio.volume = 0
  secondaryAudio.muted = appSetting['player.isMute']
  secondaryAudio.defaultPlaybackRate = primaryAudio.defaultPlaybackRate
  secondaryAudio.playbackRate = primaryAudio.playbackRate
  secondaryAudio.preservesPitch = primaryAudio.preservesPitch

  try {
    await secondaryAudio.play()
  } catch (err) {
    console.warn('[gapless] secondary audio playback failed:', err)
    finishTransition()
    return
  }
  if (transitionState !== 'crossfading' || nextSongUrl !== url) {
    secondaryAudio.pause()
    return
  }

  const targetSecondaryVolume = getSecondaryTargetVolume()
  if (!appSetting['player.fadeInFadeOut']) {
    primaryAudio.volume = 0
    secondaryAudio.volume = targetSecondaryVolume
    volumeTimer = window.setTimeout(commitTransition, NO_FADE_LEAD_TIME)
    return
  }

  const duration = getFadeDuration()
  runVolumeTransition(duration, (progress) => {
    if (primaryAudio) primaryAudio.volume = primaryStartVolume * (1 - progress)
    if (secondaryAudio) secondaryAudio.volume = targetSecondaryVolume * progress
  }, commitTransition)
}

const scheduleTransition = () => {
  clearTransitionTimer()
  if (transitionState !== 'idle' || !primaryAudio || !secondaryAudio || !nextSongUrl) return
  if (!appSetting['player.gaplessPlayback'] || primaryAudio.paused) return

  const duration = primaryAudio.duration
  if (!Number.isFinite(duration) || duration <= 0) return
  const remaining = duration - primaryAudio.currentTime
  if (remaining <= 0) return

  const leadTime = getFadeDuration() / 1000
  const playbackRate = Math.max(0.1, primaryAudio.playbackRate)
  const delay = Math.max(0, ((remaining - leadTime) / playbackRate) * 1000)
  transitionTimer = window.setTimeout(() => {
    transitionTimer = null
    void startCrossfade()
  }, delay)
}

const handlePrimaryTimeUpdate = () => {
  if (transitionTimer == null) scheduleTransition()
}

const handlePrimaryPause = () => {
  if (transitionState === 'crossfading') {
    window.setTimeout(() => {
      if (transitionState !== 'crossfading') return
      if (primaryAudio?.ended) commitTransition()
      else finishTransition()
    })
  } else if (transitionState === 'idle') {
    clearTransitionTimer()
  }
}

const handlePrimaryEnded = () => {
  if (transitionState === 'crossfading') commitTransition()
}

const handlePrimarySeeking = () => {
  const url = transitionState === 'crossfading' ? nextSongUrl : null
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
}

export const initGaplessEngine = (mainAudio: HTMLAudioElement, onTransition: TransitionHandler) => {
  destroyGaplessEngine()
  primaryAudio = mainAudio
  transitionHandler = onTransition
  createSecondaryAudio()

  primaryAudio.addEventListener('timeupdate', handlePrimaryTimeUpdate)
  primaryAudio.addEventListener('playing', handlePrimaryPlaying)
  primaryAudio.addEventListener('playing', scheduleTransition)
  primaryAudio.addEventListener('pause', handlePrimaryPause)
  primaryAudio.addEventListener('ended', handlePrimaryEnded)
  primaryAudio.addEventListener('seeking', handlePrimarySeeking)
  primaryAudio.addEventListener('ratechange', scheduleTransition)
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
  finishTransition()
  if (primaryAudio) {
    primaryAudio.removeEventListener('timeupdate', handlePrimaryTimeUpdate)
    primaryAudio.removeEventListener('playing', handlePrimaryPlaying)
    primaryAudio.removeEventListener('playing', scheduleTransition)
    primaryAudio.removeEventListener('pause', handlePrimaryPause)
    primaryAudio.removeEventListener('ended', handlePrimaryEnded)
    primaryAudio.removeEventListener('seeking', handlePrimarySeeking)
    primaryAudio.removeEventListener('ratechange', scheduleTransition)
    primaryAudio.removeEventListener('canplay', handlePrimaryCanPlay)
  }
  if (secondaryAudio) secondaryAudio.removeEventListener('error', handleSecondaryError)
  primaryAudio = null
  secondaryAudio = null
  transitionHandler = null
}
