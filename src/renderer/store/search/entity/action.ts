import { markRawList } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { sortInsert, similar } from '@common/utils/common'
import type { EntityType, ListInfoItem, SearchSource } from './state'
import { listInfos, sources } from './state'

interface SearchResult {
  list: ListInfoItem[]
  allPage: number
  limit: number
  total: number
  source: LX.OnlineSource
}

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

const setLists = (type: EntityType, results: SearchResult[], page: number, text: string) => {
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
  listInfo.noItemLabel = text && !list.length && page == 1 ? window.i18n.t('no_item') : ''
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
  if (listInfo.key == key && listInfo.list.length) return listInfo.list

  listInfo.noItemLabel = window.i18n.t('list__loading')
  listInfo.key = key
  if (sourceId == 'all') {
    const tasks = []
    for (const source of sources) {
      if (source == 'all') continue
      tasks.push((music[source]?.entitySearch?.search(type, text, page, listInfo.limit) ?? Promise.reject(new Error(`source not found: ${source}`))).catch((error: any) => {
        console.log(error)
        return {
          list: [],
          allPage: 1,
          total: 0,
          limit: listInfo.limit,
          source,
        }
      }))
    }
    return Promise.all(tasks).then((results: SearchResult[]) => {
      if (key != listInfo.key) return []
      return setLists(type, results, page, text)
    })
  }

  return (music[sourceId]?.entitySearch?.search(type, text, page, listInfo.limit).then((data: SearchResult) => {
    if (key != listInfo.key) return []
    return setList(type, data, page, text)
  }) ?? Promise.reject(new Error(`source not found: ${sourceId}`))).catch((error: any) => {
    if (key != listInfo.key) return []
    resetListInfo(type, sourceId)
    listInfo.noItemLabel = window.i18n.t('list__load_failed')
    console.log(error)
    throw error
  })
}
