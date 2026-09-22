import { LIST_IDS } from '@common/constants'
import { ref, computed, onBeforeUnmount } from '@common/utils/vueTools'
import { playList } from '@renderer/core/player/action'
import { getListMusics, addListMusics, setTempList } from '@renderer/store/list/action'
import { addHistoryWord } from '@renderer/store/search/action'
// import { useI18n } from '@renderer/plugins/i18n'
// import { } from '@renderer/store/search/state'
import { search as searchMusic, resetListInfo, listInfos, type ListInfo } from '@renderer/store/search/music'
import { assertApiSupport } from '@renderer/store/utils'
import { filterSearchSongs } from '@renderer/utils/searchMusicFilter'

export type SearchSource = LX.OnlineSource | 'all'

export default () => {
  const listRef = ref<any>(null)
  let searchRevision = 0
  let activeSource: SearchSource | undefined
  onBeforeUnmount(() => { searchRevision++; if (activeSource) resetListInfo(activeSource) })

  const listInfo = ref<ListInfo>({
    page: 1,
    maxPage: 0,
    limit: 30,
    total: 0,
    list: [],
    key: null,
    noItemLabel: '',
  })
  const mergeSongs = ref(false)
  const filtered = computed(() => filterSearchSongs(listInfo.value.list, 'all', mergeSongs.value, song => assertApiSupport(song.source)))
  const displayList = computed(() => filtered.value.list)
  const sourceLabels = computed(() => filtered.value.sourceLabels)

  const search = (text: string, source: SearchSource, page: number) => {
    if (activeSource && activeSource !== source) resetListInfo(activeSource)
    activeSource = source
    const revision = ++searchRevision
    listInfo.value = listInfos[source] as ListInfo
    if (text.length) void addHistoryWord(text)
    void searchMusic(text, page, source).then((list: LX.Music.MusicInfo[]) => {
      if (revision !== searchRevision) return
      if (list.length) {
        setTimeout(() => {
          if (revision === searchRevision && listRef.value) listRef.value.scrollToTop()
        })
      }
    }).catch(() => {}) // The store already displays the failure and enables retry.
  }

  const handlePlayList = async(index: number) => {
    const searchList = [...displayList.value]
    let targetSong = searchList[index]
    if (!targetSong) return

    if (!assertApiSupport(targetSong.source)) return

    const defaultListMusics = await getListMusics(LIST_IDS.DEFAULT)

    await addListMusics(LIST_IDS.DEFAULT, [targetSong])

    // 播放列表加入当前搜索结果的整批歌曲
    const targetIndex = searchList.findIndex(s => s.id === targetSong.id)
    if (targetIndex > -1) {
      await setTempList(`search__${listInfo.value.key ?? ''}`, [...searchList])
      playList(LIST_IDS.TEMP, targetIndex)
      return
    }

    let defaultIndex = defaultListMusics.findIndex(s => s.id === targetSong.id)
    if (defaultIndex > -1) playList(LIST_IDS.DEFAULT, defaultIndex)
  }

  return {
    listRef,
    listInfo,
    mergeSongs,
    displayList,
    sourceLabels,
    search,
    handlePlayList,
  }
}
