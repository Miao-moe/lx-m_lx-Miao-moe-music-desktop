import { onBeforeUnmount } from '@common/utils/vueTools'

import { playInfo, playMusicInfo, playQueueList, PLAY_QUEUE_LIST_ID } from '@renderer/store/player/state'
import { setPlayMusicInfo, updatePlayIndex } from '@renderer/store/player/action'
import { throttle } from '@common/utils'
import { playNext, stop } from '@renderer/core/player'

const changedListIds = new Set<string | null>()

export default () => {
  const throttleListChange = throttle(() => {
    const isSkip = playMusicInfo.listId && !changedListIds.has(playInfo.playerListId) && !changedListIds.has(playMusicInfo.listId)
    changedListIds.clear()
    if (isSkip) return

    const prevPlayIndex = playInfo.playIndex
    const { playIndex } = updatePlayIndex()
    if (playIndex < 0) { // 歌曲被移除
      if (window.lx.isPlayedStop) {
        stop()
        setTimeout(() => {
          setPlayMusicInfo(null, null)
        })
      } else if (!playMusicInfo.isTempPlay) {
        // 播放逻辑遵循播放队列，来源列表移除歌曲不影响播放队列
        if (playInfo.playerListId == PLAY_QUEUE_LIST_ID && playMusicInfo.musicInfo &&
          playQueueList.some(item => item.musicInfo.id == playMusicInfo.musicInfo?.id)) {
          // 恢复原播放位置，保证歌曲播放进度仍可被保存/恢复
          if (prevPlayIndex > -1) playInfo.playIndex = prevPlayIndex
          return
        }
        console.log('current music removed')
        void playNext(true)
      }
    }
  })

  const handleListChange = (listIds: string[]) => {
    for (const id of listIds) {
      changedListIds.add(id)
    }
    throttleListChange()
  }

  const handleDownloadListChange = () => {
    handleListChange(['download'])
  }

  window.app_event.on('myListUpdate', handleListChange)
  window.app_event.on('downloadListUpdate', handleDownloadListChange)

  onBeforeUnmount(() => {
    window.app_event.off('myListUpdate', handleListChange)
    window.app_event.off('downloadListUpdate', handleDownloadListChange)
  })
}
