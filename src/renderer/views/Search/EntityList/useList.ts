import { nextTick, ref, onBeforeUnmount } from '@common/utils/vueTools'
import { addHistoryWord } from '@renderer/store/search/action'
import {
  listInfos,
  search as searchEntity,
  resetListInfo,
  type EntityType,
  type ListInfoItem,
  type SearchListInfo,
  type SearchSource,
} from '@renderer/store/search/entity'

export default () => {
  const listRef = ref<any>(null)
  let active: { type: EntityType, source: SearchSource } | undefined
  onBeforeUnmount(() => { if (active) resetListInfo(active.type, active.source) })
  const listInfo = ref<SearchListInfo>({
    page: 1,
    limit: 18,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
    tagId: '',
    sortId: '',
  })

  const search = (type: EntityType, text: string, source: SearchSource, page: number) => {
    if (active && (active.type !== type || active.source !== source)) resetListInfo(active.type, active.source)
    active = { type, source }
    listInfo.value = listInfos[type][source]!
    if (text.length) void addHistoryWord(text)
    void searchEntity(type, text, page, source).then((list: ListInfoItem[]) => {
      if (!list.length || !listRef.value) return
      void nextTick(() => listRef.value.scrollTo(0))
    }).catch(() => {})
  }

  return {
    listRef,
    listInfo,
    search,
  }
}
