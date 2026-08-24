import { nextTick, ref } from '@common/utils/vueTools'
import { addHistoryWord } from '@renderer/store/search/action'
import {
  listInfos,
  search as searchEntity,
  type EntityType,
  type ListInfoItem,
  type SearchListInfo,
  type SearchSource,
} from '@renderer/store/search/entity'

export default () => {
  const listRef = ref<any>(null)
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
    listInfo.value = listInfos[type][source] as SearchListInfo
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
