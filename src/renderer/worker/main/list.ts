// import { throttle } from '@common/utils'

import { SPLIT_CHAR } from '@common/constants'
import { filterFileName, arrPushByPosition, arrShuffle } from '@common/utils/common'
import { searchScore } from '@common/utils/searchScore'
import { findDuplicateSongs } from '@common/musicIdentity'
import { createHash } from 'node:crypto'
import { BoundedMap } from '@common/utils/boundedMap'
import { joinPath, saveStrToFile } from '@common/utils/nodejs'
import { createLocalMusicInfo } from '@renderer/utils/music'


/**
 * 过滤列表中已播放的歌曲
 */
export const filterMusicList = async({ playedList, listId, list, playerMusicInfo, dislikeInfo, isNext }: {
  /**
   * 已播放列表
   */
  playedList: LX.Player.PlayMusicInfo[]
  /**
   * 列表id
   */
  listId: string
  /**
   * 播放列表
   */
  list: Array<LX.Music.MusicInfo | LX.Download.ListItem>
  /**
   * 下载目录
   */
  // savePath: string
  /**
   * 播放器内当前歌曲（`playInfo.playerPlayIndex`指向的歌曲）
   */
  playerMusicInfo?: LX.Music.MusicInfo | LX.Download.ListItem
  /**
   * 不喜欢的歌曲名字列表
   */
  dislikeInfo: Omit<LX.Dislike.DislikeInfo, 'rules'>

  isNext: boolean
}) => {
  let playerIndex = -1

  let canPlayList: Array<LX.Music.MusicInfo | LX.Download.ListItem> = []
  const playedCounts = new Map<string, number>()
  for (const item of playedList) {
    if (item.listId === listId && !item.isTempPlay) playedCounts.set(item.musicInfo.id, (playedCounts.get(item.musicInfo.id) ?? 0) + 1)
  }
  const hasDislike = (info: LX.Music.MusicInfo) => {
    const name = info.name?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''
    const singer = info.singer?.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim() ?? ''

    return dislikeInfo.musicNames.has(name) || dislikeInfo.singerNames.has(singer) ||
      dislikeInfo.names.has(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
  }

  let isDislike = false
  const filteredList: Array<LX.Music.MusicInfo | LX.Download.ListItem> = list.filter(s => {
    // if (!assertApiSupport(s.source)) return false
    if ('progress' in s) {
      if (!s.isComplate) return false
    } else if (hasDislike(s)) {
      if (s.id != playerMusicInfo?.id) return false
      isDislike = true
    }

    canPlayList.push(s)

    const count = playedCounts.get(s.id) ?? 0
    if (count) {
      playedCounts.set(s.id, count - 1)
      return false
    }
    return true
  })
  if (playerMusicInfo) {
    if (isDislike) {
      if (filteredList.length <= 1) {
        filteredList.splice(0, 1)
        if (canPlayList.length > 1) {
          let currentMusicIndex = canPlayList.findIndex(m => m.id == playerMusicInfo.id)
          if (isNext) {
            playerIndex = currentMusicIndex - 1
            if (playerIndex < 0 && canPlayList.length > 1) playerIndex = canPlayList.length - 2
          } else {
            playerIndex = currentMusicIndex
            if (canPlayList.length <= 1) playerIndex = -1
          }
          canPlayList.splice(currentMusicIndex, 1)
        } else canPlayList.splice(0, 1)
      } else {
        let currentMusicIndex = filteredList.findIndex(m => m.id == playerMusicInfo.id)
        if (isNext) {
          playerIndex = currentMusicIndex - 1
          if (playerIndex < 0 && filteredList.length > 1) playerIndex = filteredList.length - 2
        } else {
          playerIndex = currentMusicIndex
          if (filteredList.length <= 1) playerIndex = -1
        }
        filteredList.splice(currentMusicIndex, 1)
      }
    } else {
      playerIndex = (filteredList.length ? filteredList : canPlayList).findIndex(m => m.id == playerMusicInfo.id)
    }
  }
  return {
    filteredList,
    canPlayList,
    playerIndex,
  }
}

const getIntv = (musicInfo: LX.Music.MusicInfo) => {
  if (!musicInfo.interval) return 0
  // if (musicInfo._interval) return musicInfo._interval
  let intvArr = musicInfo.interval.split(':')
  let intv = 0
  let unit = 1
  while (intvArr.length) {
    intv += parseInt(intvArr.pop()!) * unit
    unit *= 60
  }
  return intv
}

export type SortFieldName = 'name' | 'singer' | 'albumName' | 'interval' | 'source'
export type SortFieldType = 'up' | 'down' | 'random'
/**
 * 排序歌曲
 * @param list 歌曲列表
 * @param sortType 排序类型
 * @param fieldName 排序字段
 * @param localeId 排序语言
 * @returns
 */
export const sortListMusicInfo = async(list: LX.Music.MusicInfo[], sortType: SortFieldType, fieldName: SortFieldName, localeId: string) => {
  // console.log(sortType, fieldName, localeId)
  // const locale = new Intl.Locale(localeId)
  switch (sortType) {
    case 'random':
      arrShuffle(list)
      break
    case 'up':
      if (fieldName == 'interval') {
        list.sort((a, b) => {
          if (a.interval == null) {
            return b.interval == null ? 0 : -1
          } else return b.interval == null ? 1 : getIntv(a) - getIntv(b)
        })
      } else {
        switch (fieldName) {
          case 'name':
          case 'singer':
          case 'source':
            list.sort((a, b) => {
              if (a[fieldName] == null) {
                return b[fieldName] == null ? 0 : -1
              } else return b[fieldName] == null ? 1 : a[fieldName].localeCompare(b[fieldName], localeId)
            })
            break
          case 'albumName':
            list.sort((a, b) => {
              if (a.meta.albumName == null) {
                return b.meta.albumName == null ? 0 : -1
              } else return b.meta.albumName == null ? 1 : a.meta.albumName.localeCompare(b.meta.albumName, localeId)
            })
            break
        }
      }
      break
    case 'down':
      if (fieldName == 'interval') {
        list.sort((a, b) => {
          if (a.interval == null) {
            return b.interval == null ? 0 : 1
          } else return b.interval == null ? -1 : getIntv(b) - getIntv(a)
        })
      } else {
        switch (fieldName) {
          case 'name':
          case 'singer':
          case 'source':
            list.sort((a, b) => {
              if (a[fieldName] == null) {
                return b[fieldName] == null ? 0 : 1
              } else return b[fieldName] == null ? -1 : b[fieldName].localeCompare(a[fieldName], localeId)
            })
            break
          case 'albumName':
            list.sort((a, b) => {
              if (a.meta.albumName == null) {
                return b.meta.albumName == null ? 0 : 1
              } else return b.meta.albumName == null ? -1 : b.meta.albumName.localeCompare(a.meta.albumName, localeId)
            })
            break
        }
      }
      break
  }
  return list
}

/**
 * 过滤列表内重复的歌曲
 * @param list 歌曲列表
 * @param isFilterVariant 是否过滤 Live Explicit 等歌曲名
 * @returns
 */
export const filterDuplicateMusic = async(list: LX.Music.MusicInfo[], _isFilterVariant = true) => findDuplicateSongs(list)

export const searchListMusic = (list: LX.Music.MusicInfo[], text: string) => {
  const hash = createHash('sha256').update(JSON.stringify([text, list.length]))
  for (const song of list) hash.update(JSON.stringify([song.id, song.name, song.singer, song.meta.albumName]))
  const key = hash.digest('hex')
  const cached = searchResults.get(key)
  if (cached) return cached.map(index => list[index])
  const query = text.toLowerCase()
  const exact: number[][] = [[], [], []]
  const fuzzy: Array<{ index: number, score: number }> = []
  const rxp = new RegExp(text.split('').map(s => s.replace(/[.*+?^${}()|[\]\\]/, '\\$&')).join('.*'), 'i')
  list.forEach((song, index) => {
    const fields = [song.name ?? '', song.singer ?? '', song.meta.albumName ?? '']
    const matched = fields.findIndex(field => field.toLowerCase().includes(query))
    if (matched >= 0) exact[matched].push(index)
    else {
      const value = fields.join('')
      if (rxp.test(value)) fuzzy.push({ index, score: searchScore(text, value) })
    }
  })
  fuzzy.sort((a, b) => b.score - a.score || a.index - b.index)
  const indexes = [...exact.flat(), ...fuzzy.map(item => item.index)]
  searchResults.set(key, indexes)
  return indexes.map(index => list[index])
}
const searchResults = new BoundedMap<string, number[]>(16, 100000, indexes => indexes.length)

/**
 * 创建排序后的列表
 * @param list 原始列表
 * @param position 新位置
 * @param ids 要调整顺序的歌曲id
 * @returns
 */
export const createSortedList = (list: LX.Music.MusicInfo[], position: number, ids: string[]) => {
  const infos: LX.Music.MusicInfo[] = []
  const map = new Map<string, LX.Music.MusicInfo>()
  for (const item of list) map.set(item.id, item)
  for (const id of ids) {
    infos.push(map.get(id)!)
    map.delete(id)
  }
  list = list.filter(mInfo => map.has(mInfo.id))
  arrPushByPosition(list, infos, Math.min(position, list.length))
  return list
}


/**
 * 创建本地列表音乐信息
 * @param filePaths 文件路径
 */
export const createLocalMusicInfos = async(filePaths: string[]) => {
  const musicInfos: LX.Music.MusicInfoLocal[] = []
  const failedPaths: string[] = []
  for await (const path of filePaths) {
    try {
      const musicInfo = await createLocalMusicInfo(path)
      if (musicInfo) musicInfos.push(musicInfo)
      else failedPaths.push(path)
    } catch {
      failedPaths.push(path)
    }
  }

  return { musicInfos, failedPaths }
}

/**
 * 导出列表到txt文件
 * @param savePath 保存路径
 * @param lists 列表数据
 * @param isMerge 是否合并
 */
export const exportPlayListToText = async(savePath: string, lists: Array<LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull>, isMerge: boolean) => {
  const iconv = (await import('iconv-lite')).default

  if (isMerge) {
    await saveStrToFile(savePath,
      iconv.encode(lists.map(l => l.list.map(m => `${m.name}  ${m.singer}  ${m.meta.albumName ?? ''}`).join('\n')).join('\n\n'), 'utf8', { addBOM: true }))
  } else {
    for await (const list of lists) {
      await saveStrToFile(joinPath(savePath, `lx_list_${filterFileName(list.name)}.txt`),
        iconv.encode(list.list.map(m => `${m.name}  ${m.singer}  ${m.meta.albumName ?? ''}`).join('\n'), 'utf8', { addBOM: true }))
    }
  }
}

/**
 * 导出列表到csv文件
 * @param savePath 保存路径
 * @param lists 列表数据
 * @param isMerge 是否合并
 * @param header 表头名称
 */
export const exportPlayListToCSV = async(savePath: string,
  lists: Array<LX.List.MyDefaultListInfoFull | LX.List.MyLoveListInfoFull | LX.List.UserListInfoFull>,
  isMerge: boolean,
  header: string) => {
  const iconv = (await import('iconv-lite')).default

  const filterStr = (str: string) => {
    if (!str) return ''
    str = str.replace(/"/g, '""')
    if (str.includes(',')) str = `"${str}"`
    return str
  }

  if (isMerge) {
    await saveStrToFile(savePath, iconv.encode(header + lists.map(l => l.list.map(m => `${filterStr(m.name)},${filterStr(m.singer)},${filterStr(m.meta.albumName ?? '')}`).join('\n')).join('\n'), 'utf8', { addBOM: true }))
  } else {
    for await (const list of lists) {
      await saveStrToFile(joinPath(savePath, `lx_list_${filterFileName(list.name)}.csv`), iconv.encode(header + list.list.map(m => `${filterStr(m.name)},${filterStr(m.singer)},${filterStr(m.meta.albumName ?? '')}`).join('\n'), 'utf8', { addBOM: true }))
    }
  }
}
