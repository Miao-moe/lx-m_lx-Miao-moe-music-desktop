<template>
  <div :class="$style.songList" :style="{ '--list-cover-size': `${appSetting['list.coverSize']}px` }">
    <!-- <transition enter-active-class="animated-fast fadeIn" leave-active-class="animated-fast fadeOut"> -->
    <div :class="$style.list">
      <div class="thead">
        <table :class="$style.headerTable">
          <thead>
            <tr v-if="actionButtonsVisible">
              <th class="num" style="width: 5%;">#</th>
              <th class="no-select" :class="$style.coverHeader">{{ $t('music_cover') }}</th>
              <th class="nobreak">{{ $t('music_name') }}</th>
              <th class="nobreak" style="width: 22%;">{{ $t('music_singer') }}</th>
              <th class="nobreak" style="width: 22%;">{{ $t('music_album') }}</th>
              <th class="nobreak" style="width: 9%;">{{ $t('music_time') }}</th>
              <th class="nobreak" style="width: 16%;">{{ $t('action') }}</th>
            </tr>
            <tr v-else>
              <th class="num" style="width: 5%;">#</th>
              <th class="no-select" :class="$style.coverHeader">{{ $t('music_cover') }}</th>
              <th class="nobreak">{{ $t('music_name') }}</th>
              <th class="nobreak" style="width: 24%;">{{ $t('music_singer') }}</th>
              <th class="nobreak" style="width: 27%;">{{ $t('music_album') }}</th>
              <th class="nobreak" style="width: 10%;">{{ $t('music_time') }}</th>
            </tr>
          </thead>
        </table>
      </div>
      <div :class="$style.content">
        <div v-show="!noItem" ref="dom_listContent" :class="$style.content">
          <base-virtualized-list v-if="actionButtonsVisible" ref="listRef" :list="list" key-name="id" :item-height="listItemHeight" :overscan="10" container-class="scroll" content-class="list" @contextmenu.capture="handleListRightClick">
            <template #default="{ item, index }">
              <div
                class="list-item" :class="[{ selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }]"
                @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
              >
                <div class="list-item-cell no-select num" style="flex: 0 0 5%;" @click.stop>{{ index + 1 }}</div>
                <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 calc(var(--list-cover-size) + 12px); padding: 0 6px;">
                   <img v-if="getCover(item) && !coverErrorSet.has(getCoverKey(item))" :src="getCover(item)" :alt="item.name" loading="eager" decoding="async" @error="handleCoverError(item)">
                  <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                    <use xlink:href="#icon-music" />
                  </svg>
                </div>
                <div class="list-item-cell auto name">
                  <span class="select name" :aria-label="item.name">{{ item.name }}</span>
                  <span v-if="qualityBadgeLabel(item)" class="no-select badge badge-theme-primary">{{ $t(qualityBadgeLabel(item)) }}</span>
                  <span v-if="sourceTag" class="no-select badge badge-theme-tertiary">{{ item.source }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 22%;">
                  <span v-if="canOpenEntity(item) && getSingerNames(item).length" :class="$style.entityLinks" class="select" :aria-label="item.singer">
                    <template v-for="(singer, singerIndex) in getSingerNames(item)" :key="`${singer}__${singerIndex}`">
                      <span v-if="singerIndex" :class="$style.entitySeparator">、</span>
                      <button type="button" :class="$style.entityLink" @click.stop="openEntityDetail(item, 'singer', singer)">{{ singer }}</button>
                    </template>
                  </span>
                  <span v-else class="select" :aria-label="item.singer">{{ item.singer }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 22%;">
                  <button
                    v-if="canOpenEntity(item) && item.meta.albumName" type="button" class="select" :class="$style.entityLink"
                    :aria-label="item.meta.albumName" @click.stop="openEntityDetail(item, 'album', item.meta.albumName)"
                  >
                    {{ item.meta.albumName }}
                  </button>
                  <span v-else class="select" :aria-label="item.meta.albumName">{{ item.meta.albumName }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 9%;"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
                <div class="list-item-cell" style="flex: 0 0 16%; padding-left: 0; padding-right: 0;">
                  <material-list-buttons :index="index" :remove-btn="false" :download-btn="assertApiSupport(item.source)" :play-btn="checkApiSource ? assertApiSupport(item.source) : true" @btn-click="handleListBtnClick" />
                </div>
              </div>
            </template>
            <template #footer>
              <div :class="$style.pagination">
                <material-pagination :count="total" :limit="limit" :page="page" @btn-click="$emit('togglePage', $event)" />
              </div>
            </template>
          </base-virtualized-list>
          <base-virtualized-list v-else ref="listRef" :list="list" key-name="id" :item-height="listItemHeight" :overscan="10" container-class="scroll" content-class="list" @contextmenu.capture="handleListRightClick">
            <template #default="{ item, index }">
              <div
                class="list-item" :class="[{ selected: rightClickSelectedIndex == index }, { active: selectedList.includes(item) }]"
                @click="handleListItemClick($event, index)" @contextmenu="handleListItemRightClick($event, index)"
              >
                <div class="list-item-cell no-select num" style="flex: 0 0 5%;" @click.stop>{{ index + 1 }}</div>
                <div class="list-item-cell no-select" :class="$style.cover" style="flex: 0 0 calc(var(--list-cover-size) + 12px); padding: 0 6px;">
                   <img v-if="getCover(item) && !coverErrorSet.has(getCoverKey(item))" :src="getCover(item)" :alt="item.name" loading="eager" decoding="async" @error="handleCoverError(item)">
                  <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="60%" height="60%" viewBox="0 0 24 24" space="preserve">
                    <use xlink:href="#icon-music" />
                  </svg>
                </div>
                <div class="list-item-cell auto name">
                  <span class="select name" :aria-label="item.name">{{ item.name }}</span>
                  <span v-if="qualityBadgeLabel(item)" class="no-select badge badge-theme-primary">{{ $t(qualityBadgeLabel(item)) }}</span>
                  <span v-if="sourceTag" class="no-select badge badge-theme-tertiary">{{ item.source }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 24%;">
                  <span v-if="canOpenEntity(item) && getSingerNames(item).length" :class="$style.entityLinks" class="select" :aria-label="item.singer">
                    <template v-for="(singer, singerIndex) in getSingerNames(item)" :key="`${singer}__${singerIndex}`">
                      <span v-if="singerIndex" :class="$style.entitySeparator">、</span>
                      <button type="button" :class="$style.entityLink" @click.stop="openEntityDetail(item, 'singer', singer)">{{ singer }}</button>
                    </template>
                  </span>
                  <span v-else class="select" :aria-label="item.singer">{{ item.singer }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 27%;">
                  <button
                    v-if="canOpenEntity(item) && item.meta.albumName" type="button" class="select" :class="$style.entityLink"
                    :aria-label="item.meta.albumName" @click.stop="openEntityDetail(item, 'album', item.meta.albumName)"
                  >
                    {{ item.meta.albumName }}
                  </button>
                  <span v-else class="select" :aria-label="item.meta.albumName">{{ item.meta.albumName }}</span>
                </div>
                <div class="list-item-cell" style="flex: 0 0 10%;"><span class="no-select">{{ item.interval || '--/--' }}</span></div>
              </div>
            </template>
            <template #footer>
              <div :class="$style.pagination">
                <material-pagination :count="total" :limit="limit" :page="page" @btn-click="$emit('togglePage', $event)" />
              </div>
            </template>
          </base-virtualized-list>
        </div>
        <transition enter-active-class="animated fadeIn" leave-active-class="animated fadeOut">
          <div
            v-show="noItem" :class="[$style.noitem, 'ui-state', { 'ui-state-error': isMessage(noItem, 'list__load_failed') }]"
            role="status" :aria-busy="isMessage(noItem, 'list__loading')"
          >
            <span v-if="isMessage(noItem, 'list__loading')" class="ui-spinner" />
            <p v-text="noItem" />
            <base-btn v-if="isMessage(noItem, 'list__load_failed')" class="ui-state-retry" min @click="$emit('retry')">{{ $t('reload') }}</base-btn>
          </div>
        </transition>
      </div>
    </div>
    <!-- </transition> -->
    <!-- <material-flow-btn :show="isShowEditBtn && assertApiSupport(source)" :remove-btn="false" @btn-click="handleFlowBtnClick" /> -->
    <!-- <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" @confirm="removeAllSelect" /> -->
    <common-list-add-modal v-model:show="isShowListAdd" :music-info="selectedAddMusicInfo" teleport="#view" />
    <common-list-add-multiple-modal v-model:show="isShowListAddMultiple" :music-list="selectedList" teleport="#view" @confirm="removeAllSelect" />
    <common-download-modal v-model:show="isShowDownload" :music-info="selectedDownloadMusicInfo" teleport="#view" />
    <common-download-multiple-modal v-model:show="isShowDownloadMultiple" :list="selectedList" teleport="#view" @confirm="removeAllSelect" />
    <base-menu v-model="isShowItemMenu" :menus="menus" :xy="menuLocation" item-name="name" @menu-click="handleMenuClick" />
  </div>
</template>

<script>
import { clipboardWriteText } from '@common/utils/electron'
import { assertApiSupport } from '@renderer/store/utils'
import { reactive, ref } from '@common/utils/vueTools'
import { qualityList } from '@renderer/store'
import { getMaxQuality } from '@renderer/core/music/utils'
import { getMusicCoverUrl } from '@renderer/utils/musicCover'
import useList from './useList'
import useMenu from './useMenu'
import usePlay from './usePlay'
import useMusicDownload from './useMusicDownload'
import useMusicAdd from './useMusicAdd'
import useMusicActions from './useMusicActions'
import { appSetting } from '@renderer/store/setting'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'
export default {
  name: 'MaterialOnlineList',
  props: {
    list: {
      type: Array,
      default() {
        return []
      },
    },
    page: {
      type: Number,
      required: true,
    },
    limit: {
      type: Number,
      required: true,
    },
    total: {
      type: Number,
      required: true,
    },
    sourceTag: {
      type: Boolean,
      default: false,
    },
    noItem: {
      type: String,
      default: '',
    },
    checkApiSource: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['show-menu', 'play-list', 'togglePage', 'retry'],
  setup(props, { emit }) {
    const actionButtonsVisible = appSetting['list.actionButtonsVisible']
    const { canOpenEntity, getSingerNames, openEntityDetail } = useEntityDetailNavigation()
    const rightClickSelectedIndex = ref(-1)
    const dom_listContent = ref(null)
    const listRef = ref(null)
    const isMessage = (text, key) => Object.values(window.i18n.messages).some(messages => messages[key] == text)

    const {
      selectedList,
      listItemHeight,
      handleSelectData,
      removeAllSelect,
    } = useList({ props, listRef })

    const {
      handlePlayMusic,
      handlePlayMusicLater,
      doubleClickPlay,
    } = usePlay({ selectedList, props, removeAllSelect, emit })

    const {
      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,
      handleShowMusicAddModal,
    } = useMusicAdd({ selectedList, props })

    const {
      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,
      handleShowDownloadModal,
    } = useMusicDownload({ selectedList, props })

    const {
      handleSearch,
      handleOpenMusicDetail,
      handleDislikeMusic,
    } = useMusicActions({ props })

    const {
      menus,
      menuLocation,
      isShowItemMenu,
      showMenu,
      menuClick,
    } = useMenu({
      props,
      assertApiSupport,
      emit,

      handleShowDownloadModal,
      handlePlayMusic,
      handlePlayMusicLater,
      handleSearch,
      handleShowMusicAddModal,
      handleOpenMusicDetail,
      handleDislikeMusic,
    })

    const handleListItemClick = (event, index) => {
      if (rightClickSelectedIndex.value > -1) return
      handleSelectData(index)
      doubleClickPlay(index)
    }
    const handleListItemRightClick = (event, index) => {
      rightClickSelectedIndex.value = index
      showMenu(event, props.list[index], index)
    }
    const handleMenuClick = (action) => {
      let index = rightClickSelectedIndex.value
      rightClickSelectedIndex.value = -1
      menuClick(action, index)
    }
    const handleListRightClick = (event) => {
      if (!event.target.classList.contains('select')) return
      event.stopImmediatePropagation()
      let classList = dom_listContent.value.classList
      classList.add('copying')
      window.requestAnimationFrame(() => {
        let str = window.getSelection().toString()
        classList.remove('copying')
        str = str.split(/\n\n/).map(s => s.replace(/\n/g, '  ')).join('\n').trim()
        if (!str.length) return
        clipboardWriteText(str)
      })
    }
    const handleListBtnClick = ({ action, index }) => {
      switch (action) {
        case 'download':
          handleShowDownloadModal(index, true)
          break
        case 'play':
          void handlePlayMusic(index, true)
          break
        case 'search':
          handleSearch(index)
          break
        case 'listAdd':
          handleShowMusicAddModal(index, true)
          break
      }
    }
    const scrollToTop = () => {
      listRef.value?.scrollTo(0, true)
    }

    const hasQuality = (item, quality) => {
      if (item.meta._qualitys[quality]) return true
      if (quality === 'hires' || quality === 'atmos' || quality === 'master') {
        if (!item.meta._qualitys.flac24bit) return false
      }
      return (qualityList.value[item.source] || []).includes(quality)
    }

    const coverMap = reactive(new Map())
    const coverErrorSet = reactive(new Set())
    const getCoverKey = (item) => `${item.source}__${item.id}`
    const getCover = (item) => {
      if (item.img || item.meta?.picUrl) return item.img || item.meta?.picUrl
      const key = getCoverKey(item)
      if (coverMap.has(key)) return coverMap.get(key)
      getMusicCoverUrl(item).then(url => {
        if (url) coverMap.set(key, url)
      })
      return ''
    }
    const handleCoverError = (item) => {
      coverErrorSet.add(getCoverKey(item))
    }
    const qualityBadgeLabel = (item) => {
      const maxQ = getMaxQuality(item, qualityList.value[item.source] || [])
      switch (maxQ) {
        case 'master': return 'tag__master'
        case 'atmos': return 'tag__atmos'
        case 'hires': return 'tag__hires'
        case 'flac24bit': return 'tag__lossless_24bit'
        case 'flac':
        case 'ape':
        case 'wav': return 'tag__lossless'
        case '320k': return 'tag__high_quality'
        default: return ''
      }
    }

    return {
      listItemHeight,
      isMessage,
      handleListItemClick,
      selectedList,
      handleListItemRightClick,
      removeAllSelect,
      handleListBtnClick,
      rightClickSelectedIndex,
      dom_listContent,
      listRef,

      menus,
      isShowItemMenu,
      menuLocation,
      handleMenuClick,

      handleListRightClick,
      assertApiSupport,

      isShowListAdd,
      isShowListAddMultiple,
      selectedAddMusicInfo,

      isShowDownload,
      isShowDownloadMultiple,
      selectedDownloadMusicInfo,

      scrollToTop,
      actionButtonsVisible,
      appSetting,
      hasQuality,
      qualityBadgeLabel,
      getCover,
      getCoverKey,
      coverErrorSet,
      handleCoverError,
      canOpenEntity,
      getSingerNames,
      openEntityDetail,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.songList {
  overflow: hidden;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  position: relative;
}

.list {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-flow: column nowrap;
  font-size: 14px;
}

.content {
  flex: auto;
  min-height: 0;
  position: relative;
  height: 100%;
}

.headerTable {
  table-layout: fixed;

  th {
    box-sizing: border-box;
  }

  .coverHeader {
    width: calc(var(--list-cover-size) + 12px);
    text-align: center;
  }
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

.entityLinks {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.entitySeparator {
  flex: none;
}

.entityLink {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--duration-fast) var(--ease-standard);

  &:hover {
    color: var(--color-accent);
  }

  &:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }
}

.pagination {
  text-align: center;
  padding: 15px 0;
  // left: 50%;
  // transform: translateX(-50%);
}
.noitem {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 100%;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  // background-color: var(--color-000);

  p {
    font-size: 24px;
    color: var(--color-font-label);
  }
}


</style>
