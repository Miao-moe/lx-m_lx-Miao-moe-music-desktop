import { markRawList } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { sortInsert, similar } from '@common/utils/common'
import { createAggregateSearch } from '../aggregate'
import type { EntityType, ListInfoItem, SearchSource } from './state'
import { listInfos, sources } from './state'

interface SearchResult {
  list: ListInfoItem[]
  allPage: number
  limit: number
  total: number
  source: LX.OnlineSource
}

const aggregateSearch = createAggregateSearch<SearchResult>()
export const retryFailedSources = async(type: EntityType) => aggregateSearch.retry(listInfos[type].all)

const requests = new WeakMap<object, symbol>()

const handleSortList = (list: ListInfoItem[], keyword: string) => {
  const result: Array<{ num: number, data: ListInfoItem }> = []
  for (const item of list) {
    sortInsert(result, {
      num: similar(keyword, `${item.name} ${item.author}`),
      data: item,
    })
  }
  return result.map(item => item.data).reverse()
}

const setLists = (type: EntityType, results: SearchResult[], page: number, text: string, pending = false) => {
  const totals: number[] = []
  let limit = 0
  let list: ListInfoItem[] = []
  for (const result of results) {
    if (result.allPage < page) continue
    list.push(...result.list)
    totals.push(result.total)
    limit = Math.max(result.limit, limit)
  }
  const ids = new Set<string>()
  list = list.filter(item => {
    const id = `${item.source}__${item.id}`
    if (ids.has(id)) return false
    ids.add(id)
    return true
  })
  markRawList(list)

  const listInfo = listInfos[type].all
  const total = Math.max(0, ...totals)
  if (page == 1 || (total && list.length)) listInfo.total = total
  else listInfo.total = limit * page
  listInfo.page = page
  listInfo.list = handleSortList(list, text)
  listInfo.noItemLabel = pending ? window.i18n.t('list__loading') : text && !list.length && page == 1 ? window.i18n.t('no_item') : ''
  return listInfo.list
}

const setList = (type: EntityType, data: SearchResult, page: number, text: string) => {
  const listInfo = listInfos[type][data.source]!
  listInfo.list = markRawList(data.list)
  if (page == 1 || (data.total && data.list.length)) listInfo.total = data.total
  else listInfo.total = data.limit * page
  listInfo.page = page
  listInfo.limit = data.limit
  listInfo.noItemLabel = text && !data.list.length && page == 1 ? window.i18n.t('no_item') : ''
  return listInfo.list
}

export const resetListInfo = (type: EntityType, sourceId: SearchSource): [] => {
  const listInfo = listInfos[type][sourceId]
  if (!listInfo) return []
  aggregateSearch.reset(listInfo)
  requests.delete(listInfo)
  listInfo.page = 1
  listInfo.total = 0
  listInfo.list = []
  listInfo.key = null
  listInfo.noItemLabel = ''
  return []
}

export const search = async(type: EntityType, text: string, page: number, sourceId: SearchSource): Promise<ListInfoItem[]> => {
  const listInfo = listInfos[type][sourceId]!
  if (!text) return resetListInfo(type, sourceId)
  const key = `${type}__${page}__${sourceId}__${text}`
  if (!requests.has(listInfo) && listInfo.key == key && listInfo.list.length) return listInfo.list
  const requestId = Symbol('search')
  requests.set(listInfo, requestId)
  const isCurrent = () => requests.get(listInfo) === requestId
  const finish = () => { if (isCurrent()) requests.delete(listInfo) }

  listInfo.list = []
  listInfo.noItemLabel = window.i18n.t('list__loading')
  listInfo.key = key
  if (sourceId == 'all') {
    return aggregateSearch.search(listInfo, sources, source => music[source]?.entitySearch?.search(type, text, page, listInfo.limit), (results, pending) => {
      setLists(type, results, page, text, pending)
    }).then(() => isCurrent() ? listInfo.list : []).finally(finish)
  }

  return (music[sourceId]?.entitySearch?.search(type, text, page, listInfo.limit).then((data: SearchResult) => {
    if (!isCurrent()) return []
    return setList(type, data, page, text)
  }) ?? Promise.reject(new Error(`source not found: ${sourceId}`))).catch((error: any) => {
    if (!isCurrent()) return []
    resetListInfo(type, sourceId)
    listInfo.noItemLabel = window.i18n.t('list__load_failed')
    console.log(error)
    throw error
  }).finally(finish)
}
