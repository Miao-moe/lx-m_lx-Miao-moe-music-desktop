import { computed } from '@common/utils/vueTools'
import { nativePointer, setting } from '@lyric/store/state'

export default () => {
  return computed(() => {
    // Locked/transparent windows can miss DOM mouseleave events. The main
    // process tracks the system pointer while locked, including leaving it.
    return setting['desktopLyric.isLock'] && setting['desktopLyric.isHoverHide'] && nativePointer.value !== null
  })
}
