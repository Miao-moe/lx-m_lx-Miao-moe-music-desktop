import { collectMusic, dislikeMusic, pause, play, playNext, playPrev, togglePlay, uncollectMusic } from '@renderer/core/player'

type Action = 'play' | 'pause' | 'skipNext' | 'skipPrev' | 'togglePlay' | 'collect' | 'uncollect' | 'dislike'

export default () => {
  return async(action: Action) => {
    switch (action) {
      case 'play':
        play()
        break
      case 'pause':
        pause()
        break
      case 'skipNext':
        void playNext().catch(console.error)
        break
      case 'skipPrev':
        void playPrev().catch(console.error)
        break
      case 'togglePlay':
        togglePlay()
        break
      case 'collect':
        collectMusic()
        break
      case 'uncollect':
        uncollectMusic()
        break
      case 'dislike':
        void dislikeMusic().catch(console.error)
        break
      default: throw new Error('Unknown action: ' + (action as any ?? ''))
    }
  }
}
