import { ref, onBeforeUnmount } from '@common/utils/vueTools'
import { HOTKEY_COMMON } from '@common/hotKey'

export default ({ setSelectedIndex, handlePlayMusic, listRef }) => {
  const isShowSearchBar = ref(false)
  const searchList = ref([])

  const handleShowSearchBar = () => {
    isShowSearchBar.value = true
  }

  const handleMusicSearchAction = ({ action, data: { index, isPlay } = {} }) => {
    isShowSearchBar.value = false
    switch (action) {
      case 'listClick':
        if (index < 0) return
        listRef.value.scrollToIndex(index, -150, true, () => {
          setSelectedIndex(index)
          setTimeout(() => {
            setSelectedIndex(-1)
            if (isPlay) handlePlayMusic(index)
          }, 600)
        })
        break
    }
  }

  window.key_event.on(HOTKEY_COMMON.focusListSearchInput.action, handleShowSearchBar)

  onBeforeUnmount(() => {
    window.key_event.off(HOTKEY_COMMON.focusListSearchInput.action, handleShowSearchBar)
  })

  return {
    isShowSearchBar,
    searchList,
    handleMusicSearchAction,
  }
}
