import { formatError } from '@common/utils/errorMessage'
import { ref, computed } from '@common/utils/vueTools'
import { playMusicInfo, playInfo } from '@renderer/store/player/state'
import { downloadStatus } from '@renderer/store/download/state'
import { getDownloadList } from '@renderer/store/download/action'
import { LIST_IDS } from '@common/constants'


export default (activeTab, failureKind = ref('all')) => {
  const rightClickSelectedIndex = ref(-1)
  const dom_listContent = ref(null)

  const listAll = ref([])
  const isLoading = ref(true)
  const loadError = ref('')
  const loadList = async() => {
    isLoading.value = true
    loadError.value = ''
    try {
      listAll.value = await getDownloadList()
    } catch (error) {
      console.error('Load download list failed', error)
      loadError.value = formatError(error, window.i18n.t('list__load_failed'), 'DOWNLOAD_LIST_LOAD_FAILED')
    } finally {
      isLoading.value = false
    }
  }
  loadList()

  const list = computed(() => {
    switch (activeTab.value) {
      case 'runing':
        return listAll.value.filter(i => i.status == downloadStatus.RUN || i.status == downloadStatus.WAITING)
      case 'paused':
        return listAll.value.filter(i => i.status == downloadStatus.PAUSE)
      case 'error':
        return listAll.value.filter(i => i.status == downloadStatus.ERROR && (failureKind.value === 'all' || (i.failure?.kind ?? 'unknown') === failureKind.value))
      case 'finished':
        return listAll.value.filter(i => i.status == downloadStatus.COMPLETED)
      default:
        return [...listAll.value]
    }
  })

  const playTaskId = computed(() => playMusicInfo.listId == LIST_IDS.DOWNLOAD ? listAll.value[playInfo.playIndex]?.id : '')


  return {
    rightClickSelectedIndex,
    dom_listContent,
    listAll,
    list,
    isLoading,
    loadError,
    loadList,
    playTaskId,
  }
}
