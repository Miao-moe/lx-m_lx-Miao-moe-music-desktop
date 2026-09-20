import type { FoliaConfig, FoliaSong } from './protocol'

// Keep layout/configuration updates from cloning and rebuilding an unchanged song.
export const createStageStateSender = (send: (type: 'state' | 'config', data: { song: FoliaSong, config: FoliaConfig } | FoliaConfig) => void) => {
  let previousSongInputs: readonly unknown[] | undefined
  let previousConfig: FoliaConfig | undefined
  return {
    sync(songInputs: readonly unknown[], buildSong: () => FoliaSong, config: FoliaConfig) {
      if (!previousSongInputs || songInputs.length !== previousSongInputs.length || songInputs.some((value, index) => value !== previousSongInputs?.[index])) {
        send('state', { song: buildSong(), config })
        previousSongInputs = [...songInputs]
      } else if (previousConfig && (Object.keys(config) as Array<keyof FoliaConfig>).some(key => config[key] !== previousConfig?.[key])) {
        send('config', config)
      }
      previousConfig = config
    },
    reset() {
      previousSongInputs = undefined
      previousConfig = undefined
    },
  }
}
