// if (targetSong.key) { // 如果是已下载的歌曲
//   const filePath = path.join(appSetting['download.savePath'], targetSong.metadata.fileName)
//   // console.log(filePath)

import {
  getMusicUrl as getOnlineMusicUrl,
  getPicUrl as getOnlinePicUrl,
  getLyricInfo as getOnlineLyricInfo,
} from './online'
import {
  getMusicUrl as getDownloadMusicUrl,
  getPicUrl as getDownloadPicUrl,
  getLyricInfo as getDownloadLyricInfo,
} from './download'
import {
  getMusicUrl as getLocalMusicUrl,
  getPicUrl as getLocalPicUrl,
  getLyricInfo as getLocalLyricInfo,
} from './local'
import { withRequestScope, withRequestDeadline } from '@renderer/utils/requestContext'


export const getMusicUrl = async({
  musicInfo,
  quality,
  isRefresh = false,
  onToggleSource,
  allowToggleSource,
  signal,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  quality?: LX.Quality
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
  allowToggleSource?: boolean
  signal?: AbortSignal
}): Promise<string> => {
  return withRequestDeadline(30000, async() => {
    if ('progress' in musicInfo) {
      return getDownloadMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
    } else if (musicInfo.source == 'local') {
      return getLocalMusicUrl({ musicInfo, isRefresh, onToggleSource, allowToggleSource })
    } else {
      return getOnlineMusicUrl({ musicInfo, isRefresh, quality, onToggleSource, allowToggleSource })
    }
  }, signal)
}

export const getPicPath = async({
  musicInfo,
  isRefresh = false,
  listId,
  onToggleSource,
  signal,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId?: string | null
  signal?: AbortSignal
  isRefresh?: boolean
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<string> => {
  return withRequestScope(signal, async() => {
    if ('progress' in musicInfo) {
      return getDownloadPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
    } else if (musicInfo.source == 'local') {
      return getLocalPicUrl({ musicInfo, isRefresh, listId, onToggleSource })
    } else {
      return getOnlinePicUrl({ musicInfo, isRefresh, listId, onToggleSource })
    }
  })
}

export const getLyricInfo = async({
  musicInfo,
  isRefresh = false,
  onToggleSource,
  signal,
}: {
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  isRefresh?: boolean
  signal?: AbortSignal
  onToggleSource?: (musicInfo?: LX.Music.MusicInfoOnline) => void
}): Promise<LX.Player.LyricInfo> => {
  return withRequestScope(signal, async() => {
    if ('progress' in musicInfo) {
      return getDownloadLyricInfo({ musicInfo, isRefresh, onToggleSource })
    } else if (musicInfo.source == 'local') {
      return getLocalLyricInfo({ musicInfo, isRefresh, onToggleSource })
    } else {
      return getOnlineLyricInfo({ musicInfo, isRefresh, onToggleSource })
    }
  })
}
