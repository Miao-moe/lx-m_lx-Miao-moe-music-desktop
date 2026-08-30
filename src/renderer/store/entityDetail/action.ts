import { markRaw, markRawList } from '@common/utils/vueTools'
import { deduplicationList, toNewMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import type { EntityType, ListInfoItem } from '@renderer/store/search/entity'
import type { ListDetailInfo } from '@renderer/store/songList/state'
import { entityDetailInfo, entityProfileInfo } from './state'
import type { EntityDetailInfo, EntitySummary } from './state'

interface RawMusicInfo {
  singer?: string
  albumName?: string
  meta?: {
    albumName?: string
  }
}

interface RawDetailResult {
  list: RawMusicInfo[]
  total: number
  limit: number
  source: LX.OnlineSource
  info?: ListDetailInfo['info']
}

interface EntitySdk {
  entitySearch?: {
    search: (type: EntityType, text: string, page: number, limit: number) => Promise<{ list: ListInfoItem[] }>
  }
  singer?: {
    getSongList?: (id: string, page: number, limit: number) => Promise<RawDetailResult>
    getInfo?: (id: string) => Promise<{
      info?: {
        name?: string
        desc?: string
        avatar?: string
      }
      count?: {
        music?: number | string
        album?: number | string
      }
    }>
  }
  album?: {
    getAlbumDetail?: (id: string, page: number, limit: number) => Promise<RawDetailResult>
    getAlbumListDetail?: (id: string, page: number) => Promise<RawDetailResult>
    getAlbumInfo?: (id: string) => Promise<RawAlbumInfo>
  }
  musicSearch: {
    search: (text: string, page: number, limit: number) => Promise<RawDetailResult>
  }
}

interface RawAlbumInfo {
  name?: string
  desc?: string
  author?: string
  authorName?: string
  img?: string
  image?: string
  time?: string
  play_count?: string
  total?: number | string
}

export interface EntityProfile {
  desc?: string
  img?: string
  musicCount?: number | null
  albumCount?: number | null
  playCount?: string
  publishTime?: string
}

const cache = new Map<string, EntityDetailInfo>()
const resolvedEntityCache = new Map<string, { id: string, summary: EntitySummary }>()
const profileCache = new Map<string, EntityProfile | null>()

const getSdk = (source: LX.OnlineSource) => musicSdk[source] as unknown as EntitySdk

// eslint-disable-next-line @typescript-eslint/promise-function-async
const getExactDetail = (type: EntityType, id: string, source: LX.OnlineSource, page: number) => {
  const sdk = getSdk(source)
  if (type == 'singer') return sdk.singer?.getSongList?.(id, page, 100) ?? null
  if (sdk.album?.getAlbumDetail) return sdk.album.getAlbumDetail(id, page, 100)
  if (sdk.album?.getAlbumListDetail) return sdk.album.getAlbumListDetail(id, page)
  return null
}

const normalizeText = (text = '') => text.toLowerCase().replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '')

const resolveEntity = async(type: EntityType, source: LX.OnlineSource, summary: EntitySummary) => {
  const key = `${type}__${source}__${normalizeText(summary.name)}__${normalizeText(summary.author)}`
  if (resolvedEntityCache.has(key)) return resolvedEntityCache.get(key)!

  const entitySearch = getSdk(source).entitySearch
  if (!entitySearch) return null
  const result = await entitySearch.search(type, summary.name, 1, 18)
  const sameNameList = result.list.filter(info => normalizeText(info.name) == normalizeText(summary.name))
  const author = normalizeText(summary.author)
  let info = sameNameList[0]
  if (type == 'album' && author) {
    info = sameNameList.find(info => normalizeText(info.author) == author) ?? info
  }
  if (!info) return null

  const resolvedEntity = {
    id: info.id,
    summary: {
      name: info.name || summary.name,
      author: info.author || summary.author,
      img: info.img || summary.img,
      desc: info.desc || summary.desc,
      total: Math.max(0, Number(info.total) || summary.total),
    },
  }
  resolvedEntityCache.set(key, resolvedEntity)
  return resolvedEntity
}

const filterFallbackList = (list: RawMusicInfo[], type: EntityType, summary: EntitySummary) => {
  const target = normalizeText(summary.name)
  if (!target) return list
  const matchedList = list.filter((item) => {
    if (type == 'album') return normalizeText(item.albumName ?? item.meta?.albumName) == target
    return (item.singer ?? '').split(/、|&|;|；|\/|,|，|\|/).some(name => normalizeText(name) == target)
  })
  return matchedList.length ? matchedList : list
}

const getFallbackDetail = async(type: EntityType, source: LX.OnlineSource, page: number, summary: EntitySummary): Promise<RawDetailResult> => {
  const query = type == 'album' && summary.author ? `${summary.name} ${summary.author}` : summary.name
  const result = await getSdk(source).musicSearch.search(query, page, 100)
  return {
    ...result,
    list: filterFallbackList(result.list, type, summary),
    total: summary.total || result.total,
  }
}

const normalizeResult = (result: RawDetailResult, type: EntityType, id: string, page: number, summary: EntitySummary, isFallback: boolean): EntityDetailInfo => {
  const list = markRawList(deduplicationList(result.list.map(musicInfo => toNewMusicInfo(musicInfo)) as LX.Music.MusicInfoOnline[]))
  return {
    list,
    id,
    desc: null,
    total: Number(result.total) || list.length,
    page,
    limit: Number(result.limit) || 100,
    key: null,
    source: result.source,
    type,
    isFallback,
    info: {
      name: result.info?.name || summary.name,
      author: result.info?.author || summary.author,
      img: result.info?.img || summary.img,
      desc: result.info?.desc || summary.desc,
      play_count: result.info?.play_count,
    },
    noItemLabel: '',
  }
}

const loadEntityDetail = async(type: EntityType, id: string, source: LX.OnlineSource, page: number, summary: EntitySummary) => {
  let exactId = id
  let detailSummary = summary
  if (id.startsWith('search__')) {
    try {
      const resolvedEntity = await resolveEntity(type, source, summary)
      if (resolvedEntity) {
        exactId = resolvedEntity.id
        detailSummary = resolvedEntity.summary
      }
    } catch (error) {
      console.log(error)
    }
  }

  const request = exactId.startsWith('search__') ? null : getExactDetail(type, exactId, source, page)
  if (request) {
    try {
      const result = await request
      if (!Array.isArray(result.list)) throw new Error('Invalid entity detail response')
      return normalizeResult(result, type, id, page, detailSummary, false)
    } catch (error) {
      console.log(error)
    }
  }
  const result = await getFallbackDetail(type, source, page, detailSummary)
  return normalizeResult(result, type, id, page, detailSummary, true)
}

export const getEntityDetail = async(type: EntityType, id: string, source: LX.OnlineSource, page: number, summary: EntitySummary, isRefresh = false) => {
  const key = `entity_detail__${type}__${source}__${id}__${page}`
  if (isRefresh) cache.delete(key)
  if (cache.has(key)) return cache.get(key)!
  const result = await loadEntityDetail(type, id, source, page, summary)
  result.key = key
  if (!result.isFallback) cache.set(key, result)
  return result
}

const setEntityDetail = (result: EntityDetailInfo) => {
  entityDetailInfo.list = markRaw([...result.list])
  entityDetailInfo.id = result.id
  entityDetailInfo.source = result.source
  entityDetailInfo.type = result.type
  entityDetailInfo.isFallback = result.isFallback
  entityDetailInfo.total = result.total
  entityDetailInfo.limit = result.limit
  entityDetailInfo.page = result.page
  entityDetailInfo.info = markRaw({ ...result.info })
  entityDetailInfo.noItemLabel = result.list.length ? '' : window.i18n.t('no_item')
}

export const getAndSetEntityDetail = async(type: EntityType, id: string, source: LX.OnlineSource, page: number, summary: EntitySummary, isRefresh = false) => {
  const key = `entity_detail__${type}__${source}__${id}__${page}`
  if (!isRefresh && entityDetailInfo.key == key && entityDetailInfo.list.length) return

  entityDetailInfo.key = key
  entityDetailInfo.id = id
  entityDetailInfo.source = source
  entityDetailInfo.type = type
  entityDetailInfo.page = page
  entityDetailInfo.list = []
  entityDetailInfo.total = 0
  entityDetailInfo.info = markRaw({ ...summary })
  entityDetailInfo.noItemLabel = window.i18n.t('list__loading')

  try {
    const result = await getEntityDetail(type, id, source, page, summary, isRefresh)
    if (key != entityDetailInfo.key) return
    setEntityDetail(result)
  } catch (error) {
    if (key != entityDetailInfo.key) return
    entityDetailInfo.list = []
    entityDetailInfo.total = 0
    entityDetailInfo.noItemLabel = window.i18n.t('list__load_failed')
    console.log(error)
    throw error
  }
}

export const getEntityDetailAll = async(type: EntityType, id: string, source: LX.OnlineSource, summary: EntitySummary, isRefresh = false) => {
  let detailSummary = summary
  if (id.startsWith('search__')) {
    try {
      detailSummary = (await resolveEntity(type, source, summary))?.summary ?? summary
    } catch (error) {
      console.log(error)
    }
  }

  const firstPage = await getEntityDetail(type, id, source, 1, detailSummary, isRefresh)
  if ((firstPage.isFallback && !detailSummary.total) || firstPage.total <= firstPage.limit) return firstPage.list

  const list = [...firstPage.list]
  const maxPage = Math.ceil(firstPage.total / firstPage.limit)
  for (let page = 2; page <= maxPage; page++) {
    try {
      const result = await getEntityDetail(type, id, source, page, detailSummary, isRefresh)
      if (result.isFallback != firstPage.isFallback) break
      list.push(...result.list)
    } catch (error) {
      console.log(error)
      break
    }
  }
  return deduplicationList(list)
}

const toCount = (value: number | string | undefined) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

const toText = (value: string | null | undefined) => {
  if (!value) return undefined
  return value
}

export const getEntityProfile = async(type: EntityType, id: string, source: LX.OnlineSource, summary: EntitySummary): Promise<EntityProfile | null> => {
  const sdk = getSdk(source)
  const key = `entity_profile__${type}__${source}__${id}`
  if (profileCache.has(key)) return profileCache.get(key)!

  let exactId = id
  let profileSummary = summary
  try {
    if (exactId.startsWith('search__')) {
      const resolvedEntity = await resolveEntity(type, source, summary)
      exactId = resolvedEntity?.id ?? id
      profileSummary = resolvedEntity?.summary ?? summary
    }
  } catch (error) {
    console.log(error)
  }

  let profile: EntityProfile | null = type == 'singer'
    ? {
        desc: toText(profileSummary.desc),
        img: toText(profileSummary.img),
        musicCount: toCount(profileSummary.total),
      }
    : null

  try {
    if (!exactId.startsWith('search__')) {
      if (type == 'singer' && sdk.singer?.getInfo) {
        const result = await sdk.singer.getInfo(exactId)
        profile = {
          desc: toText(result.info?.desc) ?? profile?.desc,
          img: toText(result.info?.avatar) ?? profile?.img,
          musicCount: toCount(result.count?.music) ?? profile?.musicCount,
          albumCount: toCount(result.count?.album) ?? profile?.albumCount,
        }
      } else if (type == 'album' && sdk.album?.getAlbumInfo) {
        const info: RawAlbumInfo = await sdk.album.getAlbumInfo(exactId)
        profile = {
          desc: toText(info.desc),
          img: toText(info.img) ?? toText(info.image),
          publishTime: toText(info.time),
          playCount: toText(info.play_count),
          musicCount: toCount(info.total),
        }
      }
    }
  } catch (error) {
    console.log(error)
  }
  profileCache.set(key, profile)
  return profile
}

export const getAndSetEntityProfile = async(type: EntityType, id: string, source: LX.OnlineSource, summary: EntitySummary) => {
  const key = `entity_profile__${type}__${source}__${id}`
  if (entityProfileInfo.key == key) return

  entityProfileInfo.key = key
  entityProfileInfo.desc = ''
  entityProfileInfo.img = ''
  entityProfileInfo.musicCount = null
  entityProfileInfo.albumCount = null
  entityProfileInfo.playCount = ''
  entityProfileInfo.publishTime = ''

  const profile = await getEntityProfile(type, id, source, summary)
  if (entityProfileInfo.key != key || !profile) return
  entityProfileInfo.desc = profile.desc ?? ''
  entityProfileInfo.img = profile.img ?? ''
  entityProfileInfo.musicCount = profile.musicCount ?? null
  entityProfileInfo.albumCount = profile.albumCount ?? null
  entityProfileInfo.playCount = profile.playCount ?? ''
  entityProfileInfo.publishTime = profile.publishTime ?? ''
}
