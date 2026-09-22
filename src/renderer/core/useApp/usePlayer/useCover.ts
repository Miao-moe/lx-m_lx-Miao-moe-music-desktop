import { showLoadError } from '@common/loadErrorNotice'
import { onBeforeUnmount, watch } from '@common/utils/vueTools'
import { musicInfo, playerCover } from '@renderer/store/player/state'
import { setMusicInfo } from '@renderer/store/player/action'
import { acquireCachedMusicCover, acquireMusicCover } from '@renderer/utils/coverCache'

export default () => {
  let generation = 0
  let release: (() => void) | undefined
  watch([() => musicInfo.id, () => musicInfo.pic], async([, url]) => {
    const current = ++generation
    const cached = url ? acquireCachedMusicCover(url) : undefined
    release?.()
    release = undefined
    playerCover.value = cached?.src ?? ''
    if (!url) return
    if (cached) { release = cached.release; return }
    try {
      const cover = await acquireMusicCover(url)
      if (current !== generation) { cover.release(); return }
      // eslint-disable-next-line require-atomic-updates
      release = cover.release
      playerCover.value = cover.src
    } catch (error) {
      if (current === generation) { setMusicInfo({ pic: null }); showLoadError(error, 'COVER_LOAD_FAILED') }
    }
  }, { immediate: true })
  onBeforeUnmount(() => { generation++; release?.(); playerCover.value = '' })
}
