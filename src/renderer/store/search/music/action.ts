import { markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import { sortInsert, similar } from '@common/utils/common'
import { createAggregateSearch } from '../aggregate'

import { sources, maxPages, listInfos } from './state'

interface SearchResult {
  list: LX.Music.MusicInfo[]
  allPage: number
  limit: number
  total: number
  source: LX.OnlineSource
}

const aggregateSearch = createAggregateSearch<SearchResult>()
export const retryFailedSources = async() => aggregateSearch.retry(listInfos.all)

interface PendingSearch {
  key: string
  promise: Promise<LX.Music.MusicInfo[]>
}
const pendingSearches = new Map<LX.OnlineSource | 'all', PendingSearch>()


/**
 * 按搜索关键词重新排序列表
 * @param list 歌曲列表
 * @param keyword 搜索关键词
 * @returns 排序后的列表
 */
const handleSortList = (list: LX.Music.MusicInfo[], keyword: string) => {
  let arr: any[] = []
  for (const item of list) {
    sortInsert(arr, {
      num: similar(keyword, `${item.name} ${item.singer}`),
      data: item,
    })
  }
  return arr.map(item => item.data).reverse()
}


const setLists = (results: SearchResult[], page: number, text: string, pending = false): LX.Music.MusicInfo[] => {
  let pages = []
  let totals = []
  let limit = 0
  let list = []
  for (const source of results) {
    maxPages[source.source] = source.allPage
    limit = Math.max(source.limit, limit)
    if (source.allPage < page) continue
    list.push(...source.list)
    pages.push(source.allPage)
    totals.push(source.total)
  }
  list = deduplicationList(list.map(s => markRaw(toNewMusicInfo(s))))
  let listInfo = listInfos.all
  listInfo.maxPage = Math.max(0, ...pages)
  const total = Math.max(0, ...totals)
  if (page == 1 || (total && list.length)) listInfo.total = total
  else listInfo.total = limit * page
  // listInfo.limit = limit
  listInfo.page = page
  listInfo.list = handleSortList(list, text)
  if (pending) listInfo.noItemLabel = window.i18n.t('list__loading')
  else if (text && !list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

const setList = (datas: SearchResult, page: number, text: string): LX.Music.MusicInfo[] => {
  // console.log(datas.source, datas.list)
  let listInfo = listInfos[datas.source]!
  listInfo.list = deduplicationList(datas.list.map(s => markRaw(toNewMusicInfo(s))))
  if (page == 1 || (datas.total && datas.list.length)) listInfo.total = datas.total
  else listInfo.total = datas.limit * page
  listInfo.maxPage = datas.allPage
  listInfo.page = page
  listInfo.limit = datas.limit
  if (text && !datas.list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  return listInfo.list
}

export const resetListInfo = (sourceId: LX.OnlineSource | 'all'): [] => {
  pendingSearches.delete(sourceId)
  let listInfo = listInfos[sourceId]
  if (!listInfo) return []
  aggregateSearch.reset(listInfo)
  listInfo.key = null
  listInfo.list = []
  listInfo.page = 0
  listInfo.maxPage = 0
  listInfo.total = 0
  listInfo.noItemLabel = ''
  return []
}

const performSearch = async(text: string, page: number, sourceId: LX.OnlineSource | 'all', isCurrent: () => boolean): Promise<LX.Music.MusicInfo[]> => {
  if (!isCurrent()) return []
  const listInfo = listInfos[sourceId]
  if (sourceId == 'all') {
    return aggregateSearch.search(listInfo!, sources, source => music[source]?.musicSearch?.search(text, page, listInfos.all.limit), (results, pending) => {
      setLists(results, page, text, pending)
    }).then(() => isCurrent() ? listInfo!.list : [])
  } else {
    return Promise.resolve().then(() => music[sourceId].musicSearch.search(text, page, listInfo!.limit)).then((data: SearchResult) => {
      if (!isCurrent()) return []
      return setList(data, page, text)
    }).catch((error: any) => {
      if (!isCurrent()) return []
      resetListInfo(sourceId)
      listInfo!.noItemLabel = window.i18n.t('list__load_failed')
      console.log(error)
      throw error
    })
  }
}

export const search = async(text: string, page: number, sourceId: LX.OnlineSource | 'all'): Promise<LX.Music.MusicInfo[]> => {
  if (!text) return Promise.resolve(resetListInfo(sourceId))
  const listInfo = listInfos[sourceId]!
  const key = `${page}__${text}`
  const pending = pendingSearches.get(sourceId)
  if (pending?.key === key) return pending.promise
  if (!pending && listInfo.key === key && listInfo.list.length) return Promise.resolve(listInfo.list)

  // An old query's rows must not become a cache hit for a new query still loading.
  resetListInfo(sourceId)
  listInfo.key = key
  listInfo.noItemLabel = window.i18n.t('list__loading')
  const task: PendingSearch = {
    key,
    promise: Promise.resolve().then(async() => performSearch(text, page, sourceId, () => pendingSearches.get(sourceId) === task)).finally(() => {
      if (pendingSearches.get(sourceId) === task) pendingSearches.delete(sourceId)
    }),
  }
  pendingSearches.set(sourceId, task)
  return task.promise
}
