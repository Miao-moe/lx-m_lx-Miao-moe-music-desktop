export type PlaybackChange = 'track' | 'queue' | 'navigation' | 'pause' | 'stop' | 'timed-stop'
type PlaybackPhase = 'active' | 'paused' | 'stopped' | 'waiting-stop'

// One generation and stop policy for URL loading, queue selection, buffering,
// preload and gapless handoff. Audio progress remains owned by the media element.
export const createPlaybackSession = (stopFlag: { get: () => boolean, set: (value: boolean) => void }) => {
  let revision = 0
  let phase: PlaybackPhase = 'active'
  const listeners = new Set<(reason: PlaybackChange) => void>()
  const invalidate = (reason: PlaybackChange) => {
    revision++
    for (const listener of [...listeners]) {
      try { listener(reason) } catch (error) { console.error('Playback cleanup failed:', error) }
    }
    return revision
  }
  const canAdvance = () => phase === 'active' && !stopFlag.get()
  return {
    capture: () => revision,
    isCurrent: (token: number) => token === revision,
    canAdvance,
    invalidate,
    begin(reason: 'track' | 'navigation' = 'track') {
      phase = 'active'
      stopFlag.set(false)
      return invalidate(reason)
    },
    resume() { phase = 'active'; stopFlag.set(false) },
    pause() { phase = 'paused'; invalidate('pause') },
    stop() { phase = 'stopped'; invalidate('stop') },
    timedStop() { phase = 'waiting-stop'; stopFlag.set(true); invalidate('timed-stop') },
    clearTimedStop() { stopFlag.set(false); if (phase === 'waiting-stop') phase = 'active' },
    subscribe(listener: (reason: PlaybackChange) => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const playbackSession = createPlaybackSession({
  get: () => window.lx.isPlayedStop,
  set: value => { window.lx.isPlayedStop = value },
})
