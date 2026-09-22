import { showLoadError } from '@common/loadErrorNotice'
import { formatError } from '@common/utils/errorMessage'
import { isEmpty, setPause, setPlay, setResource, setStop } from '@renderer/plugins/player'
import { isPlay, playedList, playInfo, playMusicInfo, musicInfo as _musicInfo, playQueueList, playQueueSource, PLAY_QUEUE_LIST_ID } from '@renderer/store/player/state'
import {
  getList,
  clearPlayedList,
  clearTempPlayeList,
  setPlayMusicInfo,
  addPlayedList,
  setMusicInfo,
  setAllStatus,
  setPlayListId,
  removePlayedList,
  setPlayQueue,
  updatePlayIndex,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { getMusicUrl, getPicPath, getLyricInfo } from '../music/index'
import { filterList } from './utils'
import { requestMsg } from '@renderer/utils/message'
import { getRandom } from '@renderer/utils/index'
import { addListMusics, removeListMusics } from '@renderer/store/list/action'
import { loveList } from '@renderer/store/list/state'
import { addDislikeInfo } from '@renderer/core/dislikeList'
import { cancelGaplessTransition } from '@renderer/utils/gaplessPlayer'
import { getRequestSignal, withRequestDeadline } from '@renderer/utils/requestContext'
import { readSavedQueue } from './queueSession'
import { playbackSession } from './playbackSession'
import { setProgress as setSavedProgress } from '@renderer/store/player/playProgress'
// import { checkMusicFileAvailable } from '@renderer/utils/music'

let gettingUrlId = ''
const createGettingUrlId = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem) => {
  const tInfo = 'progress' in musicInfo ? musicInfo.metadata.musicInfo.meta.toggleMusicInfo : musicInfo.meta.toggleMusicInfo
  return `${musicInfo.id}_${tInfo?.id ?? ''}`
}
const createDelayNextTimeout = (delay: number) => {
  let timeout: NodeJS.Timeout | null
  const clearDelayNextTimeout = () => {
    // console.log(this.timeout)
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  const addDelayNextTimeout = () => {
    clearDelayNextTimeout()
    timeout = setTimeout(() => {
      timeout = null
      if (window.lx.isPlayedStop) return
      console.warn('delay next timeout timeout', delay)
      void playNext(true)
    }, delay)
  }

  return {
    clearDelayNextTimeout,
    addDelayNextTimeout,
  }
}
const { addDelayNextTimeout, clearDelayNextTimeout } = createDelayNextTimeout(5000)
const { addDelayNextTimeout: addLoadTimeout, clearDelayNextTimeout: clearLoadTimeout } = createDelayNextTimeout(100000)

interface PendingTrackMetadata {
  requestId: number
  musicInfo: LX.Music.MusicInfo | LX.Download.ListItem
  listId: string | null
}

let trackMetadataRequestId = 0
let pendingTrackMetadata: PendingTrackMetadata | null = null
let metadataController = new AbortController()
let playUrlController = new AbortController()

const queueTrackMetadata = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, listId: string | null) => {
  metadataController.abort()
  metadataController = new AbortController()
  pendingTrackMetadata = {
    requestId: ++trackMetadataRequestId,
    musicInfo,
    listId,
  }
}

const isCurrentTrackMetadata = ({ requestId, musicInfo }: PendingTrackMetadata) => {
  return requestId == trackMetadataRequestId && musicInfo.id == playMusicInfo.musicInfo?.id
}

export const loadPendingTrackMetadata = () => {
  const request = pendingTrackMetadata
  if (!request) return
  pendingTrackMetadata = null

  const { musicInfo, listId } = request
  void getPicPath({ musicInfo, listId, signal: metadataController.signal }).then((url: string) => {
    if (!isCurrentTrackMetadata(request) || url == _musicInfo.pic) return
    setMusicInfo({ pic: url })
    window.app_event.picUpdated()
  }).catch(error => { if (isCurrentTrackMetadata(request)) showLoadError(error, 'COVER_LOAD_FAILED') })

  void getLyricInfo({ musicInfo, signal: metadataController.signal }).then((lyricInfo) => {
    if (!isCurrentTrackMetadata(request)) return
    setMusicInfo({
      lrc: lyricInfo.lyric,
      tlrc: lyricInfo.tlyric,
      lxlrc: lyricInfo.lxlyric,
      rlrc: lyricInfo.rlyric,
      rawlrc: lyricInfo.rawlrcInfo.lyric,
    })
    window.app_event.lyricUpdated()
  }).catch((err) => {
    console.log(err)
    if (!isCurrentTrackMetadata(request)) return
    setAllStatus(formatError(err, window.i18n.t('lyric__load_error'), 'LYRICS_LOAD_FAILED'))
  })
}

/**
 * 检查音乐信息是否已更改
 */
const diffCurrentMusicInfo = (curMusicInfo: LX.Music.MusicInfo | LX.Download.ListItem): boolean => {
  // return curMusicInfo !== playMusicInfo.musicInfo || isPlay.value
  return gettingUrlId != createGettingUrlId(curMusicInfo) || curMusicInfo.id != playMusicInfo.musicInfo?.id || isPlay.value
}

let cancelDelayRetry: (() => void) | null = null
const delayRetry = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false): Promise<string | null> => {
  // if (cancelDelayRetry) cancelDelayRetry()
  return new Promise<string | null>((resolve, reject) => {
    const signal = getRequestSignal() ?? playUrlController.signal
    if (signal.aborted) { resolve(null); return }
    const time = getRandom(2, 6)
    setAllStatus(window.i18n.t('player__getting_url_delay_retry', { time }))
    const cleanup = () => {
      signal.removeEventListener('abort', cancel)
      if (cancelDelayRetry === cancel) cancelDelayRetry = null
    }
    const timeout = setTimeout(() => {
      getMusicPlayUrl(musicInfo, isRefresh, true).then((result) => {
        cleanup()
        resolve(result)
      }).catch(async(err: any) => {
        cleanup()
        reject(err)
      })
    }, time * 1000)
    const cancel = () => {
      clearTimeout(timeout)
      cleanup()
      resolve(null)
    }
    cancelDelayRetry = cancel
    signal.addEventListener('abort', cancel, { once: true })
  })
}
const getMusicPlayUrl = async(musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh = false, isRetryed = false, quality?: LX.Quality): Promise<string | null> => {
  const signal = getRequestSignal() ?? playUrlController.signal
  if (signal.aborted) return null
  // this.musicInfo.url = await getMusicPlayUrl(targetSong, type)
  setAllStatus(window.i18n.t('player__getting_url'))
  if (appSetting['player.autoSkipOnError']) addLoadTimeout()

  // const type = getPlayType(appSetting['player.highQuality'], musicInfo)
  let toggleMusicInfo = ('progress' in musicInfo ? musicInfo.metadata.musicInfo : musicInfo).meta.toggleMusicInfo

  return (toggleMusicInfo ? getMusicUrl({
    musicInfo: toggleMusicInfo,
    isRefresh,
    quality,
    allowToggleSource: false,
    signal,
  }) : Promise.reject(new Error('not found'))).catch(async() => {
    return getMusicUrl({
      signal,
      musicInfo,
      isRefresh,
      quality,
      onToggleSource(mInfo) {
        if (diffCurrentMusicInfo(musicInfo)) return
        setAllStatus(window.i18n.t('toggle_source_try'))
      },
    })
  }).then(url => {
    if (window.lx.isPlayedStop || diffCurrentMusicInfo(musicInfo)) return null

    return url
  // eslint-disable-next-line @typescript-eslint/promise-function-async
  }).catch(err => {
    // console.log('err', err.message)
    if (window.lx.isPlayedStop ||
      diffCurrentMusicInfo(musicInfo) ||
      signal.aborted ||
      err.message == requestMsg.cancelRequest) return null

    if (err.message == requestMsg.tooManyRequests) return delayRetry(musicInfo, isRefresh)

    if (!isRetryed) return getMusicPlayUrl(musicInfo, isRefresh, true, quality)

    throw err
  })
}

export const setMusicUrl = (musicInfo: LX.Music.MusicInfo | LX.Download.ListItem, isRefresh?: boolean, quality?: LX.Quality) => {
  // if (appSetting['player.autoSkipOnError']) addLoadTimeout()
  if (!diffCurrentMusicInfo(musicInfo)) return
  playUrlController.abort()
  playUrlController = new AbortController()
  const controller = playUrlController
  if (cancelDelayRetry) cancelDelayRetry()
  gettingUrlId = createGettingUrlId(musicInfo)
  void withRequestDeadline(30000, async() => getMusicPlayUrl(musicInfo, isRefresh, false, quality), controller.signal).then((url) => {
    if (!url || controller !== playUrlController || controller.signal.aborted) return
    setResource(url)
  }).catch((err: any) => {
    if (controller !== playUrlController || controller.signal.aborted) return
    console.log(err)
    setAllStatus(formatError(err, '', 'AUDIO_URL_LOAD_FAILED'))
    window.app_event.error()
    if (appSetting['player.autoSkipOnError']) addDelayNextTimeout()
  }).finally(() => {
    if (controller === playUrlController && musicInfo === playMusicInfo.musicInfo) {
      gettingUrlId = ''
      clearLoadTimeout()
    }
  })
}

// 恢复上次播放的状态
const handleRestorePlay = async(restorePlayInfo: LX.Player.SavedPlayInfo) => {
  const musicInfo = playMusicInfo.musicInfo
  if (!musicInfo) return
  const time = appSetting['player.isSavePlayTime'] && Number.isFinite(restorePlayInfo.time) ? Math.max(0, restorePlayInfo.time) : 0
  const duration = Number.isFinite(restorePlayInfo.maxTime) ? Math.max(0, restorePlayInfo.maxTime) : 0
  setSavedProgress(time, duration)
  const token = playbackSession.capture()

  setImmediate(() => {
    if (!playbackSession.isCurrent(token) || musicInfo.id != playMusicInfo.musicInfo?.id) return
    window.app_event.setProgress(time, duration)
    window.app_event.pause()
  })

  queueTrackMetadata(musicInfo, playMusicInfo.listId)
  if (!appSetting['player.startupAutoPlay']) loadPendingTrackMetadata()

  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...playMusicInfo as LX.Player.PlayMusicInfo, listId: playInfo.playerListId ?? playMusicInfo.listId })
}


// 处理音乐播放
const handlePlay = (preloadedUrl?: string) => {
  playbackSession.begin()

  resetRandomNextMusicInfo()
  if (window.lx.restorePlayInfo) {
    void handleRestorePlay(window.lx.restorePlayInfo)
    window.lx.restorePlayInfo = null
    return
  }
  const musicInfo = playMusicInfo.musicInfo

  if (!musicInfo) return

  queueTrackMetadata(musicInfo, playMusicInfo.listId)

  setStop()
  window.app_event.pause()

  clearDelayNextTimeout()
  clearLoadTimeout()


  if (appSetting['player.togglePlayMethod'] == 'random' && !playMusicInfo.isTempPlay) addPlayedList({ ...(playMusicInfo as LX.Player.PlayMusicInfo), listId: playInfo.playerListId ?? playMusicInfo.listId })

  if (preloadedUrl) {
    playUrlController.abort()
    if (cancelDelayRetry) cancelDelayRetry()
    gettingUrlId = ''
    setResource(preloadedUrl)
  } else {
    setMusicUrl(musicInfo)
  }
}

/**
 * 恢复实际队列快照，不依赖来源歌单仍然存在或保持原顺序。
 */
export const restorePlaybackQueue = (info: LX.Player.SavedPlayInfo): boolean => {
  const queue = readSavedQueue(info)
  if (!queue) return false
  setPlayQueue(queue.items)
  playQueueSource.value = queue.sourceListId
  setPlayListId(PLAY_QUEUE_LIST_ID)
  playInfo.playerPlayIndex = queue.index
  const selected = queue.current
  if (selected) {
    window.lx.restorePlayInfo = info
    setPlayMusicInfo(selected.listId, selected.musicInfo, selected.isTempPlay)
    playInfo.playerPlayIndex = queue.index
    handlePlay()
  }
  clearPlayedList()
  for (const item of queue.played) addPlayedList(item)
  return true
}

playbackSession.subscribe(reason => {
  if (reason === 'queue') return
  playUrlController.abort()
  gettingUrlId = ''
  cancelDelayRetry?.()
  clearDelayNextTimeout()
  clearLoadTimeout()
  if (reason !== 'pause' && reason !== 'timed-stop') metadataController.abort()
})

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param id 歌曲id
 */
export const playListById = (listId: string, id: string) => {
  const prevSourceListId = playQueueSource.value
  const list = getList(listId)
  const musicInfo = list.find(m => m.id == id)
  if (!musicInfo) return
  setPlayQueue(list.map(m => ({ musicInfo: m, listId, isTempPlay: false })))
  playQueueSource.value = listId
  setPlayListId(PLAY_QUEUE_LIST_ID)
  // pause()
  setPlayMusicInfo(listId, musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevSourceListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

/**
 * 播放列表内歌曲
 * @param listId 列表id
 * @param index 播放的歌曲位置
 */
export const playList = (listId: string, index: number) => {
  const prevSourceListId = playQueueSource.value
  const list = getList(listId)
  setPlayQueue(list.map(m => ({ musicInfo: m, listId, isTempPlay: false })))
  playQueueSource.value = listId
  setPlayListId(PLAY_QUEUE_LIST_ID)
  // pause()
  setPlayMusicInfo(listId, list[index])
  if (appSetting['player.isAutoCleanPlayedList'] || prevSourceListId != listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

/**
 * 播放播放列表（播放队列）内的歌曲
 * @param index 歌曲在播放队列中的位置
 */
export const playQueueById = (index: number) => {
  const queueItem = playQueueList[index]
  if (!queueItem) return
  const prevSourceListId = playQueueSource.value
  playQueueSource.value = queueItem.listId
  setPlayListId(PLAY_QUEUE_LIST_ID)
  playInfo.playerPlayIndex = index
  setPlayMusicInfo(queueItem.listId, queueItem.musicInfo)
  if (appSetting['player.isAutoCleanPlayedList'] || prevSourceListId != queueItem.listId) clearPlayedList()
  clearTempPlayeList()
  handlePlay()
}

/**
 * 用列表内容重新填充播放队列（不改变当前播放的歌曲）
 * 用于排行榜/热门歌单等场景：先播放第一页，全量列表加载完成后更新队列
 * @param listId 列表 id（列表内容需已加载到缓存中）
 */
export const refreshPlayQueueFromList = (listId: string) => {
  if (playInfo.playerListId != PLAY_QUEUE_LIST_ID) return
  if (playQueueSource.value !== listId) return
  const list = getList(listId)
  if (!list.length) return
  setPlayQueue(list.map(m => ({ musicInfo: m, listId, isTempPlay: false })))
  updatePlayIndex()
}

const handleToggleStop = () => {
  stop()
  setPlayMusicInfo(null, null)
}

const randomNextMusicInfo = {
  info: null as LX.Player.PlayMusicInfo | null,
  // index: -1,
}
let nextMusicRequestId = 0
export const resetRandomNextMusicInfo = () => {
  nextMusicRequestId++
  if (randomNextMusicInfo.info) {
    randomNextMusicInfo.info = null
    // randomNextMusicInfo.index = -1
  }
}

export const getNextPlayMusicInfo = async(): Promise<LX.Player.PlayMusicInfo | null> => {
  if (playMusicInfo.musicInfo == null) return null
  const requestId = nextMusicRequestId

  if (randomNextMusicInfo.info) return randomNextMusicInfo.info

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) return null
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) return playedList[index]
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  // A queue change must also invalidate an in-flight random candidate lookup.
  if (requestId !== nextMusicRequestId) return null
  if (!filteredList.length) return null
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      return null
  }
  if (nextIndex < 0) return null

  const nextPlayMusicInfo = {
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  }

  if (togglePlayMethod == 'random') {
    randomNextMusicInfo.info = nextPlayMusicInfo
    // randomNextMusicInfo.index = nextIndex
  }
  return nextPlayMusicInfo
}

const handlePlayNext = (playMusicInfo: LX.Player.PlayMusicInfo, preloadedUrl?: string) => {
  // 播放队列内的歌曲，需要解析出其来源列表 id，用于列表内的播放定位/高亮
  let listId = playMusicInfo.listId
  if (listId == PLAY_QUEUE_LIST_ID) {
    listId = playQueueList.find(item => item.musicInfo.id == playMusicInfo.musicInfo.id)?.listId ?? listId
  }
  setPlayMusicInfo(listId, playMusicInfo.musicInfo, playMusicInfo.isTempPlay)
  handlePlay(preloadedUrl)
}

export const playPreloadedNext = (nextPlayMusicInfo: LX.Player.PlayMusicInfo, url: string): boolean => {
  if (!playbackSession.canAdvance() || !playMusicInfo.musicInfo || !url) return false
  handlePlayNext(nextPlayMusicInfo, url)
  return true
}
/**
 * 下一曲
 * @param isAutoToggle 是否自动切换
 * @returns
 */
export const playNext = async(isAutoToggle = false): Promise<void> => {
  if (isAutoToggle && !playbackSession.canAdvance()) return
  const token = playbackSession.begin('navigation')
  console.log('skip next', isAutoToggle)
  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    console.log('musicInfo empty')
    return
  }

  // console.log(playInfo.playerListId)
  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    console.log('currentListId empty')
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) { // 移除已播放列表内不存在原列表的歌曲
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) + 1; index < playedList.length; index++) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index < playedList.length) {
      handlePlayNext(playedList[index])
      console.log('play played list')
      return
    }
  }
  if (randomNextMusicInfo.info) {
    handlePlayNext(randomNextMusicInfo.info)
    return
  }
  // const isCheckFile = findNum > 2 // 针对下载列表，如果超过两次都碰到无效歌曲，则过滤整个列表内的无效歌曲
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: true,
  })

  if (!playbackSession.isCurrent(token) || (isAutoToggle && !playbackSession.canAdvance())) return
  if (!filteredList.length) {
    handleToggleStop()
    console.log('filtered list empty')
    return
  }
  // let currentIndex: number = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex

  let togglePlayMethod = appSetting['player.togglePlayMethod']
  if (!isAutoToggle) {
    switch (togglePlayMethod) {
      case 'list':
      case 'singleLoop':
      case 'none':
        togglePlayMethod = 'listLoop'
    }
  }
  switch (togglePlayMethod) {
    case 'listLoop':
      nextIndex = playerIndex === filteredList.length - 1 ? 0 : playerIndex + 1
      break
    case 'random':
      nextIndex = getRandom(0, filteredList.length)
      break
    case 'list':
      nextIndex = playerIndex === filteredList.length - 1 ? -1 : playerIndex + 1
      break
    case 'singleLoop':
      break
    default:
      nextIndex = -1
      console.log('stop toggle play', togglePlayMethod, isAutoToggle)
      return
  }
  if (nextIndex < 0) {
    console.log('next index empty')
    return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 上一曲
 */
export const playPrev = async(isAutoToggle = false): Promise<void> => {
  if (isAutoToggle && !playbackSession.canAdvance()) return
  const token = playbackSession.begin('navigation')
  if (playMusicInfo.musicInfo == null) {
    handleToggleStop()
    return
  }

  const currentListId = playInfo.playerListId
  if (!currentListId) {
    handleToggleStop()
    return
  }
  const currentList = getList(currentListId)

  if (playedList.length) {
    let currentId: string
    if (playMusicInfo.isTempPlay) {
      const musicInfo = currentList[playInfo.playerPlayIndex]
      if (musicInfo) currentId = musicInfo.id
    } else {
      currentId = playMusicInfo.musicInfo.id
    }
    // 从已播放列表移除播放列表已删除的歌曲
    let index
    for (index = playedList.findIndex(m => m.musicInfo.id === currentId) - 1; index > -1; index--) {
      const playMusicInfo = playedList[index]
      const currentId = playMusicInfo.musicInfo.id
      if (playMusicInfo.listId == currentListId && !currentList.some(m => m.id === currentId)) {
        removePlayedList(index)
        continue
      }
      break
    }

    if (index > -1) {
      handlePlayNext(playedList[index])
      return
    }
  }

  // const isCheckFile = findNum > 2
  let { filteredList, playerIndex } = await filterList({ // 过滤已播放歌曲
    listId: currentListId,
    list: currentList,
    playedList,
    playerMusicInfo: currentList[playInfo.playerPlayIndex],
    isNext: false,
  })
  if (!playbackSession.isCurrent(token) || (isAutoToggle && !playbackSession.canAdvance())) return
  if (!filteredList.length) {
    handleToggleStop()
    return
  }

  // let currentIndex = filteredList.indexOf(currentList[playInfo.playerPlayIndex])
  if (playerIndex == -1 && filteredList.length) playerIndex = 0
  let nextIndex = playerIndex
  if (!playMusicInfo.isTempPlay) {
    let togglePlayMethod = appSetting['player.togglePlayMethod']
    if (!isAutoToggle) {
      switch (togglePlayMethod) {
        case 'list':
        case 'singleLoop':
        case 'none':
          togglePlayMethod = 'listLoop'
      }
    }
    switch (togglePlayMethod) {
      case 'random':
        nextIndex = getRandom(0, filteredList.length)
        break
      case 'listLoop':
      case 'list':
        nextIndex = playerIndex === 0 ? filteredList.length - 1 : playerIndex - 1
        break
      case 'singleLoop':
        break
      default:
        nextIndex = -1
        return
    }
    if (nextIndex < 0) return
  }

  handlePlayNext({
    musicInfo: filteredList[nextIndex],
    listId: currentListId,
    isTempPlay: false,
  })
}

/**
 * 恢复播放
 */
export const play = () => {
  playbackSession.resume()
  if (playMusicInfo.musicInfo == null) return
  if (isEmpty()) {
    if (createGettingUrlId(playMusicInfo.musicInfo) != gettingUrlId) setMusicUrl(playMusicInfo.musicInfo)
    return
  }
  setPlay()
}

/**
 * 暂停播放
 */
export const pause = () => {
  playbackSession.pause()
  cancelGaplessTransition()
  setPause()
}

/**
 * 停止播放
 */
export const stop = () => {
  playbackSession.stop()
  playUrlController.abort()
  metadataController.abort()
  if (cancelDelayRetry) cancelDelayRetry()
  cancelGaplessTransition()
  setStop()
  const token = playbackSession.capture()
  setTimeout(() => {
    if (playbackSession.isCurrent(token)) window.app_event.stop()
  })
}

/**
 * 播放、暂停播放切换
 */
export const togglePlay = () => {
  if (isPlay.value) {
    pause()
  } else {
    play()
  }
}

/**
 * 收藏当前播放的歌曲
 */
export const collectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void addListMusics(loveList.id, ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo])
}

/**
 * 取消收藏当前播放的歌曲
 */
export const uncollectMusic = () => {
  if (!playMusicInfo.musicInfo) return
  void removeListMusics({ listId: loveList.id, ids: ['progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo.id : playMusicInfo.musicInfo.id] })
}

/**
 * 不喜欢当前播放的歌曲
 */
export const dislikeMusic = async() => {
  if (!playMusicInfo.musicInfo) return
  const minfo = 'progress' in playMusicInfo.musicInfo ? playMusicInfo.musicInfo.metadata.musicInfo : playMusicInfo.musicInfo
  await addDislikeInfo([{ name: minfo.name, singer: minfo.singer }])
  await playNext(true)
}
