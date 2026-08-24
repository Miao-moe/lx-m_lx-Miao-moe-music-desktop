import { reactive, markRaw } from '@common/utils/vueTools'
import music from '@renderer/utils/musicSdk'
import { type ListInfo, type ListInfoItem } from '@renderer/store/songList/state'

export type EntityType = 'singer' | 'album'
export type SearchSource = LX.OnlineSource | 'all'
export type SearchListInfo = Omit<ListInfo, 'source'>
export type { ListInfoItem }

interface ListInfos extends Partial<Record<LX.OnlineSource, SearchListInfo>> {
  all: SearchListInfo
}

const createListInfos = (): ListInfos => markRaw({
  all: reactive<SearchListInfo>({
    page: 1,
    limit: 15,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  }),
})

export const sources: SearchSource[] = markRaw([])
export const listInfos: Record<EntityType, ListInfos> = {
  singer: createListInfos(),
  album: createListInfos(),
}

for (const source of music.sources) {
  const sourceId = source.id as LX.OnlineSource
  if (!music[sourceId]?.entitySearch) continue
  sources.push(sourceId)
  for (const type of ['singer', 'album'] as const) {
    listInfos[type][sourceId] = reactive<SearchListInfo>({
      page: 1,
      limit: 18,
      total: 0,
      list: [],
      key: null,
      noItemLabel: '',
      tagId: '',
      sortId: '',
    })
  }
}
sources.push('all')
