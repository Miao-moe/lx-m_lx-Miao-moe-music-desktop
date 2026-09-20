interface HTMLAudioElementChrome extends HTMLAudioElement {
  setSinkId: (id: string) => Promise<void>
}
interface AudioContextWithSink extends AudioContext {
  setSinkId?: (id: string) => Promise<void>
}
interface NormalizationState { energy: number, gainDb: number }
interface AudioChannel {
  audio: HTMLAudioElement
  volume: number
  source?: MediaElementAudioSourceNode
  fader?: GainNode
  normalizer?: AudioWorkletNode
  track: string
  generation: number
  dispose: () => void
}
let audio: HTMLAudioElementChrome | null = null
let audioContext: AudioContextWithSink
let gainNode: GainNode
let defaultChannelCount = 2
let processor: { input: AudioNode, output: AudioNode } | null = null
const workletModules = new Map<string, Promise<void>>()
const channels = new Map<HTMLAudioElement, AudioChannel>()
const normalizationCache = new Map<string, NormalizationState>()
let outputVolume = 1
let outputDeviceId = 'default'
let outputBridge: { audio: HTMLAudioElementChrome, destination: MediaStreamAudioDestinationNode } | null = null
let usesOutputBridge = false
let deviceChange: Promise<void> = Promise.resolve()
let normalizationEnabled = false
let normalizationReady = false
let normalizationRequest = 0
let normalizationError: ((error: unknown) => void) | undefined

const resetNormalization = (channel: AudioChannel) => {
  channel.track = channel.audio.getAttribute('src') ? channel.audio.src : ''
  channel.generation++
  channel.normalizer?.port.postMessage({ type: 'reset', generation: channel.generation, state: normalizationCache.get(channel.track) })
}

const attachNormalizer = (channel: AudioChannel) => {
  if (!normalizationReady || channel.normalizer != null || !channel.source || !channel.fader) return
  const node = new AudioWorkletNode(audioContext, 'lx-volume-normalizer', { parameterData: { enabled: normalizationEnabled ? 1 : 0 } })
  channel.normalizer = node
  node.port.onmessage = ({ data }: MessageEvent<NormalizationState & { generation: number }>) => {
    if (data.generation !== channel.generation || !channel.track || !Number.isFinite(data.energy) || !Number.isFinite(data.gainDb)) return
    normalizationCache.delete(channel.track)
    normalizationCache.set(channel.track, { energy: data.energy, gainDb: data.gainDb })
    if (normalizationCache.size > 64) normalizationCache.delete(normalizationCache.keys().next().value!)
  }
  node.onprocessorerror = () => {
    // A failed worklet must never leave either the current or overlapping song silent.
    normalizationEnabled = false
    for (const current of channels.values()) {
      current.source?.disconnect()
      current.source?.connect(current.fader!)
      current.normalizer?.disconnect()
      current.normalizer?.port.close()
      current.normalizer = undefined
    }
    normalizationError?.(new Error('Volume normalization processor failed'))
  }
  resetNormalization(channel)
  channel.source.disconnect()
  channel.source.connect(node)
  node.connect(channel.fader)
}

const connectChannel = (channel: AudioChannel) => {
  if (!audioContext || channel.source) return
  channel.source = audioContext.createMediaElementSource(channel.audio)
  channel.fader = audioContext.createGain()
  channel.fader.gain.value = channel.volume
  channel.audio.volume = 1
  channel.source.connect(channel.fader)
  channel.fader.connect(processor?.input ?? gainNode)
  attachNormalizer(channel)
}

const registerChannel = (element: HTMLAudioElement, volume: number) => {
  const channel: AudioChannel = { audio: element, volume, track: '', generation: 0, dispose: () => {} }
  const reset = () => { resetNormalization(channel) }
  const resume = () => {
    if (audioContext?.state === 'suspended') void audioContext.resume().catch(console.error)
  }
  element.addEventListener('loadstart', reset)
  element.addEventListener('emptied', reset)
  element.addEventListener('playing', resume)
  channel.dispose = () => {
    element.removeEventListener('loadstart', reset)
    element.removeEventListener('emptied', reset)
    element.removeEventListener('playing', resume)
    channel.normalizer?.port.postMessage({ type: 'dispose' })
    channel.normalizer?.port.close()
    channel.normalizer?.disconnect()
    channel.source?.disconnect()
    channel.fader?.disconnect()
    channels.delete(element)
  }
  channels.set(element, channel)
  connectChannel(channel)
  return channel
}

// Crossfades change this envelope, never the signal measured by the normalizer.
export const gaplessAudioOutput = {
  attach(element: HTMLAudioElement) { return registerChannel(element, 0).dispose },
  getVolume(element: HTMLAudioElement) { return channels.get(element)?.volume ?? 1 },
  setVolume(element: HTMLAudioElement, volume: number) {
    const channel = channels.get(element)
    if (!channel) return
    channel.volume = Math.max(0, Math.min(1, volume))
    if (channel.fader) channel.fader.gain.value = channel.volume
    else element.volume = Math.min(1, outputVolume) * channel.volume
  },
  getTargetVolume() { return 1 },
}

export const createAudio = () => {
  if (audio) return
  audio = new window.Audio() as HTMLAudioElementChrome
  audio.controls = false
  audio.autoplay = true
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'

  registerChannel(audio, 1)
}

export const getAudioElement = (): HTMLAudioElement => {
  if (!audio) throw new Error('audio not defined')
  return audio
}

const reconnectSource = () => {
  for (const channel of channels.values()) {
    channel.fader?.disconnect()
    channel.fader?.connect(processor?.input ?? gainNode)
  }
}
export const supportsAudioOutputDeviceSelection = () => typeof (window.AudioContext.prototype as AudioContextWithSink).setSinkId === 'function' ||
  (typeof HTMLMediaElement.prototype.setSinkId === 'function' && typeof window.AudioContext.prototype.createMediaStreamDestination === 'function')
const initAdvancedAudioFeatures = () => {
  if (audioContext) return
  if (!audio) throw new Error('audio not defined')
  if (outputDeviceId !== 'default' && !supportsAudioOutputDeviceSelection()) throw new Error('The selected output device does not support audio processing')
  const options: AudioContextOptions & { sinkId: string } = { latencyHint: 'playback', sinkId: outputDeviceId }
  audioContext = new window.AudioContext(options)
  defaultChannelCount = audioContext.destination.channelCount
  gainNode = audioContext.createGain()
  gainNode.gain.value = outputVolume
  gainNode.connect(audioContext.destination)
  for (const channel of channels.values()) connectChannel(channel)
  window.app_event.on('playerDeviceChanged', reconnectSource)
  if (!audioContext.setSinkId && outputDeviceId !== 'default') {
    void setMediaDeviceId(outputDeviceId).catch(error => {
      console.error('Audio output device unavailable:', error)
      void setMediaDeviceId('default').catch(console.error)
    })
  }
}
export const getAudioContext = () => {
  initAdvancedAudioFeatures()
  return audioContext
}
export const attachAudioProcessor = (input: AudioNode, output: AudioNode) => {
  initAdvancedAudioFeatures()
  if (processor) throw new Error('An audio processor is already connected')
  const attached = { input, output }
  processor = attached
  output.connect(gainNode)
  reconnectSource()
  return () => {
    if (processor !== attached) return
    processor = null
    output.disconnect(gainNode)
    reconnectSource()
  }
}
export const createAudioAnalyser = () => {
  initAdvancedAudioFeatures()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 256
  // A separate branch observes the audio without adding processing to playback.
  gainNode.connect(analyser)
  let disposed = false
  return {
    analyser,
    dispose() {
      if (disposed) return
      disposed = true
      gainNode.disconnect(analyser)
      analyser.disconnect()
    },
  }
}
export const loadAudioWorklet = async(name: string, url: string) => {
  initAdvancedAudioFeatures()
  let promise = workletModules.get(name)
  if (!promise) {
    promise = audioContext.audioWorklet.addModule(url).catch((error) => {
      workletModules.delete(name)
      throw error
    })
    workletModules.set(name, promise)
  }
  return promise
}

export const setVolumeNormalization = async(enabled: boolean, onError?: (error: unknown) => void) => {
  const request = ++normalizationRequest
  normalizationEnabled = enabled
  normalizationError = onError
  if (enabled) {
    await loadAudioWorklet('lx-volume-normalizer', new URL('./volume-normalizer.worklet.js', import.meta.url).href)
    if (request !== normalizationRequest) return
    normalizationReady = true
    for (const channel of channels.values()) attachNormalizer(channel)
  }
  if (request !== normalizationRequest) return
  for (const channel of channels.values()) channel.normalizer?.parameters.get('enabled')?.setValueAtTime(enabled ? 1 : 0, audioContext.currentTime)
}

let unsubMediaListChangeEvent: (() => void) | null = null
export const setMaxOutputChannelCount = (enable: boolean) => {
  if (enable) {
    initAdvancedAudioFeatures()
    audioContext.destination.channelCountMode = 'max'
    audioContext.destination.channelCount = audioContext.destination.maxChannelCount
    // navigator.mediaDevices.addEventListener('devicechange', handleMediaListChange)
    if (!unsubMediaListChangeEvent) {
      let handleMediaListChange = () => {
        setMaxOutputChannelCount(true)
      }
      window.app_event.on('playerDeviceChanged', handleMediaListChange)
      unsubMediaListChangeEvent = () => {
        window.app_event.off('playerDeviceChanged', handleMediaListChange)
        unsubMediaListChangeEvent = null
      }
    }
  } else {
    unsubMediaListChangeEvent?.()
    if (audioContext && audioContext.destination.channelCountMode != 'explicit') {
      audioContext.destination.channelCount = defaultChannelCount
      // audioContext.destination.channelInterpretation
      audioContext.destination.channelCountMode = 'explicit'
    }
  }
  if (outputBridge) outputBridge.destination.channelCount = audioContext.destination.channelCount
}

export const hasInitedAdvancedAudioFeatures = (): boolean => audioContext != null

export const setResource = (src: string) => {
  if (audio) {
    audio.src = src
    resetNormalization(channels.get(audio)!)
  }
}

export const setPlay = () => {
  void audio?.play()
}

export const setPause = () => {
  audio?.pause()
}

export const setStop = () => {
  if (audio) {
    audio.src = ''
    audio.removeAttribute('src')
  }
}

export const isEmpty = (): boolean => !audio?.src

export const setLoopPlay = (isLoop: boolean) => {
  if (audio) audio.loop = isLoop
}

export const getPlaybackRate = (): number => {
  return audio?.defaultPlaybackRate ?? 1
}

export const setPlaybackRate = (rate: number) => {
  if (!audio) return
  audio.defaultPlaybackRate = rate
  audio.playbackRate = rate
}

export const setPreservesPitch = (preservesPitch: boolean) => {
  if (!audio) return
  audio.preservesPitch = preservesPitch
}

export const getMute = (): boolean => {
  return audio?.muted ?? false
}

export const setMute = (isMute: boolean) => {
  if (audio) audio.muted = isMute
}

export const getCurrentTime = () => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return audio?.currentTime || 0
}

export const setCurrentTime = (time: number) => {
  if (audio) audio.currentTime = time
}

const changeMediaDeviceId = async(mediaDeviceId: string): Promise<void> => {
  if (!audio) return
  if (audioContext?.setSinkId) await audioContext.setSinkId(mediaDeviceId)
  else if (audioContext) {
    if (mediaDeviceId === 'default' || !mediaDeviceId) {
      if (usesOutputBridge && outputBridge) {
        gainNode.disconnect(outputBridge.destination)
        gainNode.connect(audioContext.destination)
        outputBridge.audio.pause()
        usesOutputBridge = false
      }
    } else {
      if (!supportsAudioOutputDeviceSelection()) throw new Error('Output device switching is unavailable')
      if (!outputBridge) {
        const destination = audioContext.createMediaStreamDestination()
        destination.channelCount = audioContext.destination.channelCount
        const element = new window.Audio() as HTMLAudioElementChrome
        element.srcObject = destination.stream
        outputBridge = { audio: element, destination }
      }
      // Chromium 108 can route an HTML audio element to a device, but cannot
      // route AudioContext directly. Keep effects/normalization upstream and
      // switch the final output only after the new device is ready.
      await outputBridge.audio.setSinkId(mediaDeviceId)
      await outputBridge.audio.play()
      if (!usesOutputBridge) {
        gainNode.disconnect(audioContext.destination)
        gainNode.connect(outputBridge.destination)
        usesOutputBridge = true
      }
    }
  } else {
    await Promise.all(Array.from(channels.values(), async channel => {
      if ('setSinkId' in channel.audio) await (channel.audio as HTMLAudioElementChrome).setSinkId(mediaDeviceId)
    }))
  }
  outputDeviceId = mediaDeviceId
}

export const setMediaDeviceId = async(mediaDeviceId: string): Promise<void> => {
  const change = deviceChange.catch(() => {}).then(async() => changeMediaDeviceId(mediaDeviceId))
  deviceChange = change
  return change
}

export const setVolume = (volume: number) => {
  outputVolume = volume
  if (audio && volume > 1 && !gainNode) {
    initAdvancedAudioFeatures()
  }
  if (gainNode) {
    gainNode.gain.value = volume
  } else {
    for (const channel of channels.values()) channel.audio.volume = Math.min(1, volume) * channel.volume
  }
}

export const getDuration = () => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return audio?.duration || 0
}

// export const getPlaybackRate = () => {
//   return audio?.playbackRate ?? 1
// }

type Noop = () => void

export const onPlaying = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('playing', callback)
  return () => {
    audio?.removeEventListener('playing', callback)
  }
}

export const onPause = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio?.addEventListener('pause', callback)
  return () => {
    audio?.removeEventListener('pause', callback)
  }
}

export const onEnded = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('ended', callback)
  return () => {
    audio?.removeEventListener('ended', callback)
  }
}

export const onError = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('error', callback)
  return () => {
    audio?.removeEventListener('error', callback)
  }
}

export const onLoadeddata = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('loadeddata', callback)
  return () => {
    audio?.removeEventListener('loadeddata', callback)
  }
}

export const onLoadstart = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('loadstart', callback)
  return () => {
    audio?.removeEventListener('loadstart', callback)
  }
}

export const onCanplay = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('canplay', callback)
  return () => {
    audio?.removeEventListener('canplay', callback)
  }
}

export const onEmptied = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('emptied', callback)
  return () => {
    audio?.removeEventListener('emptied', callback)
  }
}

export const onTimeupdate = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('timeupdate', callback)
  return () => {
    audio?.removeEventListener('timeupdate', callback)
  }
}

// 缓冲中
export const onWaiting = (callback: Noop) => {
  if (!audio) throw new Error('audio not defined')

  audio.addEventListener('waiting', callback)
  return () => {
    audio?.removeEventListener('waiting', callback)
  }
}

// 可见性改变
export const onVisibilityChange = (callback: Noop) => {
  document.addEventListener('visibilitychange', callback)
  return () => {
    document.removeEventListener('visibilitychange', callback)
  }
}


export const getErrorCode = () => {
  return audio?.error?.code
}
