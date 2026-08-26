<template>
  <div :class="$style.download" :style="{ '--list-cover-size': `${appSetting['list.coverSize']}px` }">
    <div :class="$style.header">
      <base-tab v-model="activeTab" :class="$style.tab" :list="tabs" />
    </div>
    <div :class="$style.content">
      <div class="thead" :class="$style.thead">
        <table>
          <thead>
            <tr>
              <th class="num" style="width: 5%;">#</th>
              <th class="no-select" :class="$style.coverHeader">{{ $t('music_cover') }}</th>
              <th class="nobreak">{{ $t('music_name') }}</th>
              <th class="nobreak" style="width: 20%;">{{ $t('download__progress') }}</th>
              <th class="nobreak" style="width: 22%;">{{ $t('download__status') }}</th>
              <th class="nobreak" style="width: 10%;">{{ $t('download__quality') }}</th>
              <th class="nobreak" style="width: 13%;">{{ $t('action') }}</th>
            </tr>
          </thead>
        </table>
      </div>
      <div v-if="list.length" ref="dom_listContent" :class="$style.content">
        <base-virtualized-list
          ref="listRef" v-slot="{ item, index }" :list="list" key-name="id" :item-height="listItemHeight"
          :overscan="10" container-class="scroll" content-class="list"
        >
          <div
            class="list-item"
            :class="[{[$style.active]: playTaskId == item.id }, { selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }]"
            @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
          >
            <div class="list-item-cell no-select" :class="$style.num" style="flex: 0 0 5%;">
              <transition name="play-active">
                <div v-if="playTaskId == item.id" :class="$style.playIcon">
                  <span class="playing-equalizer" :class="{ paused: !isPlay }" aria-hidden="true"><span /><span /><span /></span>
                </div>
                <div v-else class="num">{{ index + 1 }}</div>
              </transition>
            </div>
            <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 calc(var(--list-cover-size) + 12px); padding: 0 6px;">
              <img v-if="getCover(item) && !coverErrorSet.has(getCoverKey(item))" :src="getCover(item)" loading="eager" decoding="async" @error="handleCoverError(item)">
              <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-music" />
              </svg>
            </div>
            <div class="list-item-cell auto name">
              <span class="select name" :aria-label="getName(item)">{{ getName(item) }}</span>
            </div>
            <div class="list-item-cell" style="flex: 0 0 20%;">{{ item.progress }}%<span v-if="item.status == downloadStatus.RUN && item.speed"> - {{ item.speed }}/s</span></div>
            <div class="list-item-cell" style="flex: 0 0 22%;" :aria-label="item.statusText">{{ item.statusText }}</div>
            <div class="list-item-cell" style="flex: 0 0 10%;">{{ getTypeName(item.metadata.quality) }}</div>
            <div class="list-item-cell" style="flex: 0 0 13%; padding-left: 0; padding-right: 0;">
              <material-list-buttons
                :index="index" :download-btn="false" :file-btn="item.status != downloadStatus.ERROR" remove-btn="remove-btn"
                :start-btn="!item.isComplate && item.status != downloadStatus.WAITING && (item.status != downloadStatus.RUN)"
                :pause-btn="!item.isComplate && (item.status == downloadStatus.RUN || item.status == downloadStatus.WAITING)"
                :list-add-btn="false" :play-btn="item.status == downloadStatus.COMPLETED"
                :search-btn="item.status == downloadStatus.ERROR" @btn-click="handleListBtnClick"
              />
            </div>
          </div>
        </base-virtualized-list>
      </div>
      <div v-else :class="[$style.noItem, 'ui-state']" role="status">
        <p v-text="$t('no_item')" />
      </div>
      <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
      <!-- <base-menu :menus="listItemMenu" :location="listMenu.menuLocation" item-name="name" :is-show="listMenu.isShowItemMenu" @menu-click="handleListItemMenuClick" /> -->
    </div>
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedList" teleport="#view" @confirm="removeAllSelect" />
  </div>
</template>

<script>
// import { checkPath, openDirInExplorer, openUrl } from '@common/utils/electron'

import { ref, reactive } from '@common/utils/vueTools'
import useListInfo from './useListInfo'
import useList from './useList'
import useTab from './useTab'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useTaskActions from './useTaskActions'
import useMusicAdd from './useMusicAdd'
import { downloadStatus } from '@renderer/store/download/state'
import { appSetting } from '@renderer/store/setting'
import { isPlay } from '@renderer/store/player/state'
import { formatMusicName } from '@renderer/utils'
import { getMusicCoverUrl } from '@renderer/utils/musicCover'

export default {
  name: 'Download',
  setup() {
    const listRef = ref()
    const { tabs, activeTab } = useTab()

    const {
      rightClickSelectedIndex,
      dom_listContent,
      listAll,
      list,
      playTaskId,
    } = useListInfo(activeTab)

    const {
      selectedList,
      listItemHeight,
      removeAllSelect,
      handleSelectData,
    } = useList({ listRef, list, listAll })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
    } = usePlay({ selectedList, list, listAll, removeAllSelect })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleStartTask,
      handlePauseTask,
      handleRemoveTask,
      handleOpenFile,
    } = useTaskActions({ list, removeAllSelect, selectedList })

    const {
      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
    } = useMusicAdd({ selectedList, list })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      handleStartTask,
      handlePauseTask,
      handleRemoveTask,
      handleOpenFile,
      handlePlayMusic,
      handlePlayMusicLater,
      handleShowMusicAddModal,
      handleSearch,
      handleOpenMusicDetail,
    })

    let clickTime = 0
    let clickIndex = -1
    const doubleClickPlay = index => {
      if (
        window.performance.now() - clickTime > 400 ||
      clickIndex !== index
      ) {
        clickTime = window.performance.now()
        clickIndex = index
        return
      }
      const task = list.value[index]
      if (task.isComplate) {
        handlePlayMusic(list.value.indexOf(task), true)
      } else if (task.status === downloadStatus.RUN || task.status === downloadStatus.WAITING) {
        void handlePauseTask(index, true)
      } else {
        void handleStartTask(index, true)
      }
      clickTime = 0
      clickIndex = -1
    }

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, list.value[index], index)
    }
    const handleMenuClick = (action) => {
      let index = rightClickSelectedIndex.value
      rightClickSelectedIndex.value = -1
      menuClick(action, index)
    }

    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'play':
          handlePlayMusic(index, true)
          break
        case 'start':
          void handleStartTask(index, true)
          break
        case 'pause':
          void handlePauseTask(index, true)
          break
        case 'remove':
          void handleRemoveTask(index, true)
          break
        case 'file':
          void handleOpenFile(index)
          break
        case 'search':
          handleSearch(index)
          break
      }
    }

    const getName = (downloadInfo) => {
      return formatMusicName(appSetting['download.fileName'], downloadInfo.metadata.musicInfo.name, downloadInfo.metadata.musicInfo.singer)
    }
    const coverMap = reactive(new Map())
    const coverErrorSet = reactive(new Set())
    const getCoverKey = (item) => {
      const info = item.metadata.musicInfo
      return `${info.source}__${info.id}`
    }
    const handleCoverError = (item) => {
      coverErrorSet.add(getCoverKey(item))
    }
    const getCover = (item) => {
      const info = item.metadata.musicInfo
      if (info.img || info.meta?.picUrl) return info.img || info.meta?.picUrl
      const key = getCoverKey(item)
      if (coverMap.has(key)) return coverMap.get(key)
      getMusicCoverUrl(info).then(url => {
        if (url) coverMap.set(key, url)
      })
      return ''
    }
    const getTypeName = (quality) => {
      switch (quality) {
        case 'flac24bit':
          return 'FLAC 24Bit'
        case 'hires':
          return 'HIRES'
        case 'atmos':
          return 'ATMOS'
        case 'master':
          return 'MASTER'
        default:
          return quality?.toUpperCase()
      }
    }
    return {
      listRef,
      list,
      downloadStatus,
      rightClickSelectedIndex,
      dom_listContent,
      tabs,
      activeTab,
      selectedList,
      listItemHeight,
      playTaskId,

      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,

      removeAllSelect,

      menus,
      menuLocation,
      isShowItemMenu,

      handleListItemClick,
      handleListItemRightClick,
      handleMenuClick,
      handleListBtnClick,

      getName,
      getTypeName,
      isPlay,
      appSetting,
      getCover,
      getCoverKey,
      coverErrorSet,
      handleCoverError,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.download {
  position: relative;
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;

  :global(.list-item) {
    &.active {
      color: var(--color-button-font);
    }
  }
}
.num {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.coverHeader {
  width: calc(var(--list-cover-size) + 12px);
  box-sizing: border-box;
  text-align: center;
}
.cover {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;

  img {
    width: var(--list-cover-size);
    height: var(--list-cover-size);
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  svg {
    width: 60%;
    height: auto;
    fill: var(--color-font-label);
    opacity: .5;
  }
}
.playIcon {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;

  color: var(--color-button-font);
  opacity: .7;
}

.content {
  min-height: 0;
  font-size: 14px;
  display: flex;
  flex-flow: column nowrap;
  flex: auto;
}

.noItem {
  position: relative;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}

</style>

