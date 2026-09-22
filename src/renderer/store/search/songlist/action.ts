import { formatError } from '@common/utils/errorMessage'
import { markRawList } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { sortInsert, similar } from '@common/utils/common'
import { createAggregateSearch } from '../aggregate'
import { withRequestDeadline } from '@renderer/utils/requestContext'

import type { ListInfoItem } from './state'
import { sources, listInfos } from './state'

interface SearchResult {
  list: ListInfoItem[]
  limit: number
  total: number
  source: LX.OnlineSource
}

const aggregateSearch = createAggregateSearch<SearchResult>()
const cacheExpires = new WeakMap<object, number>()
export const retryFailedSources = async(source?: LX.OnlineSource) => aggregateSearch.retry(listInfos.all, source)

const requests = new WeakMap<object, symbol>()
const controllers = new WeakMap<object, AbortController>()

/**
 * 按搜索关键词重新排序列表
 * @param list 歌曲列表
 * @param keyword 搜索关键词
 * @returns 排序后的列表
 */
const handleSortList = (list: ListInfoItem[], keyword: string) => {
  let arr: any[] = []
  for (const item of list) {
    sortInsert(arr, {
      num: similar(keyword, item.name),
      data: item,
    })
  }
  return arr.map(item => item.data).reverse()
}


const setLists = (results: SearchResult[], page: number, text: string, pending = false): ListInfoItem[] => {
  let totals = []
  let limit = 0
  let list = []
  for (const source of results) {
    list.push(...source.list)
    totals.push(source.total)
    limit = Math.max(source.limit, limit)
  }
  markRawList(list)

  let listInfo = listInfos.all
  const total = Math.max(0, ...totals)
  if (page == 1 || (total && list.length)) listInfo.total = total
  else listInfo.total = limit * page
  listInfo.page = page
  listInfo.list = handleSortList(list, text)
  if (pending) listInfo.noItemLabel = window.i18n.t('list__loading')
  else if (text && !list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  if (!pending) cacheExpires.set(listInfo, Date.now() + 30000)
  return listInfo.list
}

const setList = (datas: SearchResult, page: number, text: string): ListInfoItem[] => {
  // console.log(datas.source, datas.list)
  let listInfo = listInfos[datas.source]!
  listInfo.list = markRawList(datas.list)
  if (page == 1 || (datas.total && datas.list.length)) listInfo.total = datas.total
  else listInfo.total = datas.limit * page
  listInfo.page = page
  listInfo.limit = datas.limit
  if (text && !datas.list.length && page == 1) listInfo.noItemLabel = window.i18n.t('no_item')
  else listInfo.noItemLabel = ''
  cacheExpires.set(listInfo, Date.now() + 30000)
  return listInfo.list
}

export const resetListInfo = (sourceId: LX.OnlineSource | 'all'): [] => {
  let listInfo = listInfos[sourceId]
  if (!listInfo) return []
  controllers.get(listInfo)?.abort()
  controllers.delete(listInfo)
  cacheExpires.delete(listInfo)
  aggregateSearch.reset(listInfo)
  requests.delete(listInfo)
  listInfo.page = 1
  listInfo.limit = 20
  listInfo.total = 0
  listInfo.list = []
  listInfo.key = null
  listInfo.noItemLabel = ''
  listInfo.tagId = ''
  listInfo.sortId = ''
  return []
}

export const search = async(text: string, page: number, sourceId: LX.OnlineSource | 'all'): Promise<ListInfoItem[]> => {
  const listInfo = listInfos[sourceId]!
  if (!text) return resetListInfo(sourceId)
  const key = `${page}__${sourceId}__${text}`
  if (!requests.has(listInfo) && listInfo.key == key && listInfo.list.length && (cacheExpires.get(listInfo) ?? 0) > Date.now()) return listInfo.list
  controllers.get(listInfo)?.abort()
  const controller = new AbortController()
  controllers.set(listInfo, controller)
  const requestId = Symbol('search')
  requests.set(listInfo, requestId)
  const isCurrent = () => requests.get(listInfo) === requestId
  const finish = () => { if (isCurrent()) requests.delete(listInfo) }
  listInfo.list = []
  if (sourceId == 'all') {
    listInfo.noItemLabel = window.i18n.t('list__loading')
    listInfo.key = key
    return aggregateSearch.search(listInfo, sources, source => music[source]?.songList?.search(text, page, listInfo.limit), (results, pending) => {
      setLists(results, page, text, pending)
    }).then(() => isCurrent() ? listInfo.list : []).finally(finish)
  } else {
    listInfo.noItemLabel = window.i18n.t('list__loading')
    listInfo.key = key
    const searchPromise = withRequestDeadline(20000, async() => music[sourceId]?.songList?.search(text, page, listInfo.limit), controller.signal)
    return (searchPromise?.then((data: SearchResult) => {
      if (!isCurrent()) return []
      return setList(data, page, text)
    }) ?? Promise.reject(new Error('source not found: ' + sourceId))).catch((error: any) => {
      if (!isCurrent()) return []
      resetListInfo(sourceId)
      listInfo.noItemLabel = formatError(error, window.i18n.t('list__load_failed'), 'LIST_LOAD_FAILED')
      console.log(error)
      throw error
    }).finally(finish)
  }
}
