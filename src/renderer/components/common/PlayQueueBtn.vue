<template>
  <div ref="dom_btn" :class="$style.content" @click.stop="toggleShow">
    <button :class="$style.btn" :aria-label="$t('player__play_list')">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" viewBox="0 0 24 24" space="preserve">
        <use xlink:href="#icon-playlist" />
      </svg>
    </button>
    <teleport to="#root">
      <div v-if="isShow" :class="$style.popup" :style="popupStyle" @click.stop>
        <div :class="$style.header">
          <span :class="$style.title">{{ $t('player__play_list') }}（{{ playQueueList.length }}）</span>
          <button :class="$style.clearBtn" :disabled="!playQueueList.length" :aria-label="$t('player__play_list_clear')" @click="handleClear">
            {{ $t('player__play_list_clear') }}
          </button>
        </div>
        <div :class="$style.listContent">
          <base-virtualized-list
            v-if="queueList.length"
            ref="listRef"
            v-slot="{ item, index }"
            :list="queueList"
            key-name="key"
            :item-height="rowHeight"
            container-class="scroll"
            content-class="list"
          >
            <div
              :class="[$style.item, { [$style.active]: isCurrentItem(item) }]"
              :aria-label="getMusicName(item) + ' - ' + getMusicSinger(item)"
              @click="handlePlay(index)"
            >
              <div :class="$style.itemNum">
                <svg v-if="isCurrentItem(item)" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="60%" viewBox="0 0 24 24" space="preserve">
                  <use xlink:href="#icon-play-outline" />
                </svg>
                <span v-else>{{ index + 1 }}</span>
              </div>
              <div :class="$style.itemImg">
                <svg v-if="!getCover(item) || imgErrorSet.has(item.key)" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                  <use xlink:href="#icon-music" />
                </svg>
                <img v-else :src="getCover(item)" :alt="getMusicName(item)" loading="lazy" decoding="async" @error="handleImgError(item.key)" />
              </div>
              <div :class="$style.itemInfo">
                <div :class="$style.itemName">{{ getMusicName(item) }}</div>
                <div :class="$style.itemSinger">{{ getMusicSinger(item) }}</div>
              </div>
              <button :class="$style.removeBtn" :aria-label="$t('player__play_list_remove')" @click.stop="handleRemove(index)">
                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" height="100%" viewBox="0 0 24 24" space="preserve">
                  <use xlink:href="#icon-close" />
                </svg>
              </button>
            </div>
          </base-virtualized-list>
          <div v-else :class="$style.empty">{{ $t('player__play_list_empty') }}</div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from '@common/utils/vueTools'
import { playQueueList, playMusicInfo } from '@renderer/store/player/state'
import { removePlayQueue, clearPlayQueue, updatePlayIndex, setPlayMusicInfo } from '@renderer/store/player/action'
import { getMusicCoverUrl } from '@renderer/utils/musicCover'
import { playQueueById, stop } from '@renderer/core/player'

const rowHeight = 36
const panelWidth = 380

const dom_btn = ref(null)
const listRef = ref(null)
const isShow = ref(false)

const popupStyle = reactive({
  left: '0px',
  bottom: '0px',
  width: panelWidth + 'px',
  height: '500px',
})

const queueList = computed(() => playQueueList.map((item, index) => ({
  key: `${index}_${item.musicInfo.id}`,
  musicInfo: item.musicInfo,
  listId: item.listId,
})))

const getMusicInfo = (item) => {
  const info = item.musicInfo
  return 'progress' in info ? info.metadata.musicInfo : info
}
const getMusicName = (item) => getMusicInfo(item).name
const getMusicSinger = (item) => getMusicInfo(item).singer
const isCurrentItem = (item) => playMusicInfo.musicInfo?.id == item.musicInfo.id

const imgErrorSet = reactive(new Set())
const coverMap = reactive(new Map())

const handleImgError = (key) => {
  imgErrorSet.add(key)
}

const getCover = (item) => {
  const info = getMusicInfo(item)
  if (info.img || info.meta?.picUrl) return info.img || info.meta?.picUrl
  const key = `${item.musicInfo.source}__${item.musicInfo.id}`
  if (coverMap.has(key)) return coverMap.get(key)
  getMusicCoverUrl(item.musicInfo).then(url => {
    if (url) coverMap.set(key, url)
  })
  return ''
}

const currentQueueIndex = () => {
  const id = playMusicInfo.musicInfo?.id
  if (!id) return -1
  return playQueueList.findIndex(item => item.musicInfo.id == id)
}

// 当前歌曲不在可视范围内时，自动滚动播放列表到对应位置
const scrollToCurrent = () => {
  const index = currentQueueIndex()
  if (index < 0 || !listRef.value) return
  const el = listRef.value.$el
  if (!el?.clientHeight) return
  const top = index * rowHeight
  const bottom = top + rowHeight
  if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
    listRef.value.scrollToIndex(index, -Math.round((el.clientHeight - rowHeight) / 2))
  }
}

watch(() => playMusicInfo.musicInfo?.id, () => {
  if (isShow.value) scrollToCurrent()
})

const updatePosition = () => {
  if (!dom_btn.value) return
  const rect = dom_btn.value.getBoundingClientRect()
  const width = Math.min(panelWidth, window.innerWidth - 16)
  const height = Math.max(200, Math.min(500, rect.top - 16))
  popupStyle.left = Math.max(8, rect.right - width) + 'px'
  popupStyle.bottom = (window.innerHeight - rect.top + 8) + 'px'
  popupStyle.width = width + 'px'
  popupStyle.height = height + 'px'
}

const handleDocumentClick = () => {
  isShow.value = false
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('click', handleDocumentClick)
}

const toggleShow = () => {
  if (isShow.value) {
    handleDocumentClick()
  } else {
    isShow.value = true
    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('click', handleDocumentClick)
    void nextTick(() => {
      scrollToCurrent()
    })
  }
}

const handlePlay = (index) => {
  playQueueById(index)
}

const handleRemove = (index) => {
  removePlayQueue(index)
  updatePlayIndex()
}

const handleClear = () => {
  const hasCurrent = clearPlayQueue()
  updatePlayIndex()
  if (hasCurrent) {
    stop()
    setTimeout(() => {
      setPlayMusicInfo(null, null)
    })
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('click', handleDocumentClick)
})

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.content {
  flex: none;
  height: 100%;
  position: relative;
  display: inline-block;
}

.btn {
  position: relative;
  justify-content: center;
  align-items: center;
  transition: color @transition-normal;
  cursor: pointer;
  background-color: transparent;
  border: none;
  width: 24px;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  padding: 0;

  svg {
    transition: opacity @transition-fast;
    opacity: .6;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    svg {
      opacity: .9;
    }
  }
  &:active {
    svg {
      opacity: 1;
    }
  }
}

.popup {
  position: fixed;
  z-index: 10;
  border-radius: 4px;
  background-color: var(--color-content-background);
  filter: drop-shadow(0px 0px 3px rgba(0, 0, 0, .12));
  display: flex;
  flex-flow: column nowrap;
  overflow: hidden;
}

.header {
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-primary-alpha-200);
}

.title {
  font-size: 14px;
  color: var(--color-font);
}

.clearBtn {
  background-color: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-font-label);
  font-size: 12px;
  padding: 4px 8px;
  border-radius: @radius-border;
  transition: color @transition-fast;

  &:hover {
    color: var(--color-primary);
  }
  &:disabled {
    opacity: .4;
    cursor: not-allowed;
  }
}

.listContent {
  flex: auto;
  min-height: 0;
  position: relative;
  display: flex;
  flex-flow: column nowrap;

  :global(.list) {
    flex: auto;
  }
}

.item {
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  height: 100%;
  padding: 0 6px;
  box-sizing: border-box;
  cursor: pointer;
  transition: background-color @transition-fast;
  font-size: 12px;

  &:hover {
    background-color: var(--color-primary-background-hover);

    .removeBtn {
      opacity: .7;
    }
  }

  &.active {
    color: var(--color-primary);
    background-color: var(--color-primary-background-active);
  }
}

.itemNum {
  flex: none;
  width: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  font-size: 11px;

  svg {
    fill: currentColor;
  }
}

.itemImg {
  flex: none;
  width: 30px;
  height: 30px;
  margin-left: 6px;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--color-primary-background-active);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  svg {
    fill: var(--color-font-label);
    opacity: .5;
  }
}

.itemInfo {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  line-height: 1.4;
  padding-left: 8px;
}

.itemName {
  .mixin-ellipsis-1();
}

.itemSinger {
  .mixin-ellipsis-1();
  font-size: 11px;
  color: var(--color-font-label);
}

.removeBtn {
  flex: none;
  width: 20px;
  height: 20px;
  margin-left: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: none;
  cursor: pointer;
  color: var(--color-font-label);
  opacity: .4;
  padding: 0;
  transition: opacity @transition-fast;

  &:hover {
    opacity: 1 !important;
    color: @red-500;
  }
}

.empty {
  flex: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-font-label);
  font-size: 14px;
}

</style>
