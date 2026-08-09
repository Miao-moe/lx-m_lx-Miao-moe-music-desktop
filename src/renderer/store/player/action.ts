// import { reactive, ref, shallowRef } from '@common/utils/vueTools'
import {
  type PlayerMusicInfo,
  musicInfo,
  isPlay,
  status,
  statusText,
  isShowPlayerDetail,
  isShowPlayComment,
  isShowLrcSelectContent,
  playInfo,
  playMusicInfo,
  playedList,
  tempPlayList,
  playQueueList,
  PLAY_QUEUE_LIST_ID,
} from './state'
import { getListMusicsFromCache } from '@renderer/store/list/action'
import { downloadList } from '@renderer/store/download/state'
import { setProgress } from './playProgress'
import { playQueueById, resetRandomNextMusicInfo } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'
import { toRaw } from '@common/utils/vueTools'
import showToast from '@renderer/plugins/Toast'


type PlayerMusicInfoKeys = keyof typeof musicInfo

const musicInfoKeys: PlayerMusicInfoKeys[] = Object.keys(musicInfo) as PlayerMusicInfoKeys[]

export const setMusicInfo = (_musicInfo: Partial<PlayerMusicInfo>) => {
  for (const key of musicInfoKeys) {
    const val = _musicInfo[key]
    if (val !== undefined) {
      // @ts-expect-error
      musicInfo[key] = val
    }
  }
}

export const setPlay = (val: boolean) => {
  isPlay.value = val
}

export const setStatus = (val: string) => {
  console.log('setStatus', val)
  status.value = val
}


export const setStatusText = (val: string) => {
  statusText.value = val
}

export const setAllStatus = (val: string) => {
  console.log('setAllStatus', val)
  status.value = val
  statusText.value = val
}


export const setShowPlayerDetail = (val: boolean) => {
  isShowPlayerDetail.value = val
}

export const setShowPlayComment = (val: boolean) => {
  isShowPlayComment.value = val
}

export const setShowPlayLrcSelectContentLrc = (val: boolean) => {
  isShowLrcSelectContent.value = val
}

export const setPlayListId = (listId: string | null) => {
  playInfo.playerListId = listId
}

export const getList = (listId: string | null): Array<LX.Music.MusicInfo | LX.Download.ListItem> => {
  if (listId == LIST_IDS.DOWNLOAD) return downloadList
  if (listId == PLAY_QUEUE_LIST_ID) return playQueueList.map(item => item.musicInfo)
  return getListMusicsFromCache(listId)
}

/**
 * 设置播放列表（播放队列）
 * @param list 播放队列
 */
export const setPlayQueue = (list: LX.Player.PlayMusicInfo[]) => {
  playQueueList.splice(0, playQueueList.length)
  for (const item of list) playQueueList.push(item)
}
/**
 * 从播放列表（播放队列）移除歌曲
 * @param index 歌曲位置
 */
export const removePlayQueue = (index: number) => {
  playQueueList.splice(index, 1)
  resetRandomNextMusicInfo()
}
/**
 * 清空播放列表（播放队列）
 * @returns 是否包含当前正在播放的歌曲（调用方可根据返回值决定是否停止播放）
 */
export const clearPlayQueue = (): boolean => {
  const hasCurrent = playQueueList.some(item => item.musicInfo.id == playMusicInfo.musicInfo?.id)
  playQueueList.splice(0, playQueueList.length)
  resetRandomNextMusicInfo()
  return hasCurrent
}

/**
 * 更新播放位置
 * @returns 播放位置
 */
export const updatePlayIndex = () => {
  const indexInfo = getPlayIndex(playMusicInfo.listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  // console.log(indexInfo)
  playInfo.playIndex = indexInfo.playIndex
  playInfo.playerPlayIndex = indexInfo.playerPlayIndex

  return indexInfo
}

export const getPlayIndex = (listId: string | null, musicInfo: LX.Download.ListItem | LX.Music.MusicInfo | null, isTempPlay: boolean): {
  playIndex: number
  playerPlayIndex: number
} => {
  const playerList = getList(playInfo.playerListId)

  // if (listIndex < 0) throw new Error('music info not found')
  // playInfo.playIndex = listIndex

  let playIndex = -1
  let playerPlayIndex = -1
  // playerPlayIndex 是当前歌曲在播放器播放列表（播放队列）中的位置
  if (playerList.length && playInfo.playerPlayIndex > -1) {
    playerPlayIndex = Math.min(playInfo.playerPlayIndex, playerList.length - 1)
  }
  if (!isTempPlay && musicInfo && playerList.length) {
    const currentId = musicInfo.id
    const queueIndex = playerList.findIndex(m => m.id == currentId)
    if (queueIndex > -1) {
      playerPlayIndex = queueIndex
    } else if (playInfo.playerPlayIndex > -1) {
      // 当前歌曲已被移出播放队列，播放位置后退一位
      playerPlayIndex = Math.min(playInfo.playerPlayIndex - 1, playerList.length - 1)
      if (playerPlayIndex < 0) playerPlayIndex = playerList.length - 1
    }
  }

  // playIndex 是当前歌曲在其所属列表中的位置
  const list = getList(listId)
  if (list.length && musicInfo) {
    playIndex = list.findIndex(m => m.id == musicInfo.id)
  }

  return {
    playIndex,
    playerPlayIndex,
  }
}

export const resetPlayerMusicInfo = () => {
  setMusicInfo({
    id: null,
    pic: null,
    lrc: null,
    tlrc: null,
    rlrc: null,
    lxlrc: null,
    rawlrc: null,
    name: '',
    singer: '',
    album: '',
  })
}

const setPlayerMusicInfo = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem | null) => {
  if (musicInfo) {
    setMusicInfo('progress' in musicInfo ? {
      id: musicInfo.id,
      pic: musicInfo.metadata.musicInfo.meta.picUrl,
      name: musicInfo.metadata.musicInfo.name,
      singer: musicInfo.metadata.musicInfo.singer,
      album: musicInfo.metadata.musicInfo.meta.albumName ?? '',
      lrc: null,
      tlrc: null,
      rlrc: null,
      lxlrc: null,
      rawlrc: null,
    } : {
      id: musicInfo.id,
      pic: musicInfo.meta.picUrl,
      name: musicInfo.name,
      singer: musicInfo.singer,
      album: musicInfo.meta.albumName ?? '',
      lrc: null,
      tlrc: null,
      rlrc: null,
      lxlrc: null,
      rawlrc: null,
    })
  } else resetPlayerMusicInfo()
}

/**
 * 设置当前播放歌曲的信息
 * @param listId 歌曲所属的列表id
 * @param musicInfo 歌曲信息
 * @param isTempPlay 是否临时播放
 */
export const setPlayMusicInfo = (listId: string | null, musicInfo: LX.Download.ListItem | LX.Music.MusicInfo | null, isTempPlay: boolean = false) => {
  musicInfo = toRaw(musicInfo)

  playMusicInfo.listId = listId
  playMusicInfo.musicInfo = musicInfo
  playMusicInfo.isTempPlay = isTempPlay

  setPlayerMusicInfo(musicInfo)

  setProgress(0, 0)

  if (musicInfo == null) {
    playInfo.playIndex = -1
    playInfo.playerListId = null
    playInfo.playerPlayIndex = -1
  } else {
    const { playIndex, playerPlayIndex } = getPlayIndex(listId, musicInfo, isTempPlay)

    playInfo.playIndex = playIndex
    playInfo.playerPlayIndex = playerPlayIndex
    window.app_event.musicToggled()
  }
}

/**
 * 将歌曲添加到已播放列表
 * @param playMusicInfo playMusicInfo对象
 */
export const addPlayedList = (playMusicInfo: LX.Player.PlayMusicInfo) => {
  const id = playMusicInfo.musicInfo.id
  if (playedList.some(m => m.musicInfo.id === id)) return
  playedList.push(playMusicInfo)
}
/**
 * 将歌曲从已播放列表移除
 * @param index 歌曲位置
 */
export const removePlayedList = (index: number) => {
  playedList.splice(index, 1)
}
/**
 * 清空已播放列表
 */
export const clearPlayedList = () => {
  playedList.splice(0, playedList.length)
}

/**
 * 添加歌曲到播放队列中当前歌曲的下一首位置（稍后播放）
 * @param list 歌曲列表
 */
export const addTempPlayList = (list: LX.Player.TempPlayListItem[]) => {
  const currentIndex = playQueueList.findIndex(item => item.musicInfo.id == playMusicInfo.musicInfo?.id)
  const insertIndex = currentIndex > -1 ? currentIndex + 1 : playQueueList.length
  const items: LX.Player.PlayMusicInfo[] = list.map(({ musicInfo, listId }) => ({ musicInfo, listId, isTempPlay: false }))
  playQueueList.splice(insertIndex, 0, ...items)
  // 屏幕中间提示已添加到播放列表
  showToast(window.i18n.t('player__play_list_added'))
  // 未在播放任何歌曲时，直接开始播放插入的歌曲（保持原有行为）
  if (!playMusicInfo.musicInfo) void playQueueById(insertIndex)
}
/**
 * 从稍后播放列表移除歌曲
 * @param index 歌曲位置
 */
export const removeTempPlayList = (index: number) => {
  tempPlayList.splice(index, 1)
}
/**
 * 清空稍后播放列表
 */
export const clearTempPlayeList = () => {
  tempPlayList.splice(0, tempPlayList.length)
}
