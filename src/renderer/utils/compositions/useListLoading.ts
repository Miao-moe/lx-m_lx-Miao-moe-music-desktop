import { inject, provide, type InjectionKey, type WatchSource } from 'vue'
import { nextTick, onBeforeUnmount, ref, watch } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'

export const listLoadingKey: InjectionKey<{ hold: (kind?: 'content' | 'cover') => () => void }> = Symbol('list-loading')

// Rows and covers register while the content is mounted but hidden. Once shown,
// scrolling can load more rows without hiding the whole list again.
export default (sources: WatchSource[], isLoading: () => boolean, isImmediate = () => appSetting['list.loadingMode'] === 'immediate') => {
  const parent = inject(listLoadingKey, null)
  const ready = ref(false)
  const pending = new Set<symbol>()
  const pendingCovers = new Set<symbol>()
  let revision = 0
  let frame = 0
  let disposed = false
  let finishParent: (() => void) | undefined

  const check = () => {
    const current = ++revision
    cancelAnimationFrame(frame)
    if (disposed || ready.value) return
    if (isImmediate()) {
      ready.value = true
      return
    }
    if (isLoading() || pending.size) return
    if (appSetting['list.loadingMode'] !== 'progressive' && pendingCovers.size) return
    void nextTick(() => {
      if (disposed || current !== revision) return
      // Allow layout and IntersectionObserver to start visible lazy covers.
      frame = requestAnimationFrame(() => {
        if (disposed || current !== revision) return
        frame = requestAnimationFrame(() => {
          if (disposed || current !== revision) return
          ready.value = true
        })
      })
    })
  }

  provide(listLoadingKey, {
    hold: (kind = 'content') => {
      const token = Symbol('list-resource')
      const resources = kind === 'cover' ? pendingCovers : pending
      resources.add(token)
      check()
      return () => {
        if (resources.delete(token)) check()
      }
    },
  })
  watch(ready, value => {
    if (value) {
      finishParent?.()
      finishParent = undefined
    } else finishParent ??= parent?.hold()
  }, { immediate: true, flush: 'sync' })
  watch(sources, () => {
    ready.value = false
    check()
  }, { immediate: true, flush: 'sync' })
  // Apply changes to an ongoing wait without hiding content already on screen.
  watch(() => appSetting['list.loadingMode'], check, { flush: 'sync' })
  onBeforeUnmount(() => {
    disposed = true
    revision++
    cancelAnimationFrame(frame)
    pending.clear()
    pendingCovers.clear()
    finishParent?.()
  })
  return ready
}
