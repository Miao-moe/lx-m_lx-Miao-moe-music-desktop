import { onBeforeUnmount } from '@common/utils/vueTools'
import { rendererOn, rendererOff } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { refreshLibrary } from '@renderer/utils/libraryMaintenance'

export default () => {
  let timer: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  const changed = () => { clearTimeout(debounce); debounce = setTimeout(() => { void refreshLibrary() }, 1500) }
  onBeforeUnmount(() => {
    clearInterval(timer)
    clearTimeout(debounce)
    rendererOff(WIN_MAIN_RENDERER_EVENT_NAME.library_folder_changed, changed)
  })
  return () => {
    void refreshLibrary()
    timer = setInterval(() => { void refreshLibrary() }, 60000)
    rendererOn(WIN_MAIN_RENDERER_EVENT_NAME.library_folder_changed, changed)
  }
}
