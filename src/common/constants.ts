export const APP_ID = 'com.lx-m.music.desktop'
export const APP_NAME = 'LX-M Music'
export const APP_PROTOCOL_SCHEME = 'lxmmusic'
export const LEGACY_APP_PROTOCOL_SCHEME = 'lxmusic'
export const URL_SCHEME = 'lxmmusic://'
export const URL_SCHEME_RXP = /^lxmmusic:\/\//

export const SPLIT_CHAR = {
  DISLIKE_NAME: '@',
  DISLIKE_NAME_ALIAS: '#',
} as const

export const STORE_NAMES = {
  APP_SETTINGS: 'config_v2',
  DATA: 'data',
  SYNC: 'sync',
  HOTKEY: 'hot_key',
  USER_API: 'user_api',
  LRC_RAW: 'lyrics',
  LRC_EDITED: 'lyrics_edited',
  THEME: 'theme',
  SOUND_EFFECT: 'sound_effect',
} as const

export const APP_EVENT_NAMES = {
  winMainName: 'win_main',
  winLyricName: 'win_lyric',
  trayName: 'tray',
} as const

export const LIST_IDS = {
  DEFAULT: 'default',
  LOVE: 'love',
  TEMP: 'temp',
  DOWNLOAD: 'download',
  PLAY_LATER: null,
} as const

export const DATA_KEYS = {
  viewPrevState: 'viewPrevState',
  playInfo: 'playInfo',
  searchHistoryList: 'searchHistoryList',
  listScrollPosition: 'listScrollPosition',
  listPrevSelectId: 'listPrevSelectId',
  listUpdateInfo: 'listUpdateInfo',
  ignoreVersion: 'ignoreVersion',

  leaderboardSetting: 'leaderboardSetting',
  songListSetting: 'songListSetting',
  searchSetting: 'searchSetting',

  lastStartInfo: 'lastStartInfo',
} as const

export const DEFAULT_SETTING = {
  leaderboard: {
    source: 'kw',
    boardId: 'kw__16',
  },

  songList: {
    source: 'kw',
    sortId: 'new',
    tagId: '',
  },

  search: {
    temp_source: 'kw',
    source: 'all',
    type: 'music',
  },

  viewPrevState: {
    url: '/search',
    query: {},
  },
}

export const DOWNLOAD_STATUS = {
  RUN: 'run',
  WAITING: 'waiting',
  PAUSE: 'pause',
  ERROR: 'error',
  COMPLETED: 'completed',
} as const

export const QUALITYS = ['master', 'atmos', 'hires', 'flac24bit', 'flac', 'wav', 'ape', '320k', '192k', '128k'] as const

export const TRAY_AUTO_ID = -1
