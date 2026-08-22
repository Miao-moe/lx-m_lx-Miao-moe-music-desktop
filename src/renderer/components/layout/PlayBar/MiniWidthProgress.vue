<template>
  <div :class="$style.player">
    <div :class="$style.picContent" :aria-label="$t('player__pic_tip')" @contextmenu="handleToMusicLocation" @click="showPlayerDetail">
      <transition name="cover-swap">
        <img v-if="musicInfo.pic" :key="musicInfo.pic" :src="musicInfo.pic" decoding="async" @error="imgError">
        <div v-else key="empty-cover" :class="$style.emptyPic">L<span>X</span></div>
      </transition>
    </div>
    <div :class="$style.infoSlot">
      <transition name="track-info">
        <div :key="musicInfo.id || 'empty-track'" :class="$style.infoContent">
          <div :class="$style.title" :aria-label="title + $t('copy_tip')" @click="handleCopy(title)">
            {{ title }}
          </div>
          <div :class="[$style.status, { [$style.busyStatus]: isBuffering }]">
            <span>{{ statusText }}</span>
          </div>
        </div>
      </transition>
    </div>
    <!-- <div :class="$style.timeContainer">
      <div :class="$style.timeContent">
        <span>{{ nowPlayTimeStr }}</span>
        <span style="margin: 0 1px;">/</span>
        <span>{{ maxPlayTimeStr }}</span>
        <div :class="$style.progress">
          <common-progress-bar v-if="!isShowPlayerDetail" :class-name="$style.progressBar" :progress="progress" :handle-transition-end="handleTransitionEnd" :is-active-transition="isActiveTransition" />
        </div>
      </div>
    </div> -->
    <play-progress />
    <control-btns />
    <div :class="$style.playBtnContent">
      <button type="button" :class="$style.playBtn" :aria-label="$t('player__prev')" @click="playPrev()">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-prevMusic" />
        </svg>
      </button>
      <button type="button" :class="[$style.playBtn, $style.primaryPlayBtn]" :aria-label="isPlay ? $t('player__pause') : $t('player__play')" @click="togglePlay">
        <transition name="control-swap">
          <svg v-if="isPlay" key="pause" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
            <use xlink:href="#icon-pause" />
          </svg>
          <svg v-else key="play" version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
            <use xlink:href="#icon-play" />
          </svg>
        </transition>
      </button>
      <button type="button" :class="$style.playBtn" :aria-label="$t('player__next')" @click="playNext()">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 1024 1024" space="preserve">
          <use xlink:href="#icon-nextMusic" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script>
import { computed } from '@common/utils/vueTools'
import { useRouter } from '@common/utils/vueRouter'
import { clipboardWriteText } from '@common/utils/electron'
import ControlBtns from './ControlBtns.vue'
import PlayProgress from './PlayProgress.vue'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'
// import { lyric } from '@renderer/core/share/lyric'
import {
  statusText,
  musicInfo,
  isShowPlayerDetail,
  isPlay,
  playInfo,
  playMusicInfo,
} from '@renderer/store/player/state'
import {
  setMusicInfo,
  setShowPlayerDetail,
} from '@renderer/store/player/action'
import { appSetting } from '@renderer/store/setting'
import { togglePlay, playNext, playPrev } from '@renderer/core/player'
import { LIST_IDS } from '@common/constants'
import { formatMusicName } from '@renderer/utils'

export default {
  name: 'CorePlayBar',
  components: {
    ControlBtns,
    PlayProgress,
  },
  setup() {
    const router = useRouter()

    const {
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
    } = usePlayProgress()

    const showPlayerDetail = () => {
      if (!playMusicInfo.musicInfo) return
      setShowPlayerDetail(true)
    }
    const handleCopy = (text) => {
      clipboardWriteText(text)
    }

    const imgError = () => {
      // console.log(e)
      setMusicInfo({ pic: null })
    }

    const handleToMusicLocation = () => {
      const listId = playMusicInfo.listId
      if (!listId || listId == LIST_IDS.DOWNLOAD || !playMusicInfo.musicInfo) return
      if (playInfo.playIndex == -1) return
      void router.push({
        path: '/list',
        query: {
          id: listId,
          scrollIndex: playInfo.playIndex,
        },
      })
    }

    const title = computed(() => {
      return musicInfo.name
        ? formatMusicName(appSetting['download.fileName'], musicInfo.name, musicInfo.singer)
        : ''
    })
    const isBuffering = computed(() => {
      const text = statusText.value
      const retryText = window.i18n.t('player__getting_url_delay_retry', { time: '__TIME__' })
      const [retryPrefix, retrySuffix] = retryText.split('__TIME__')
      return [
        window.i18n.t('player__loading'),
        window.i18n.t('player__buffering'),
        window.i18n.t('player__getting_url'),
        window.i18n.t('player__refresh_url'),
        window.i18n.t('toggle_source_try'),
      ].includes(text) || (text.startsWith(retryPrefix) && text.endsWith(retrySuffix))
    })

    // onBeforeUnmount(() => {
    // window.eventHub.emit(eventPlayerNames.setTogglePlay)
    // })

    return {
      musicInfo,
      nowPlayTimeStr,
      maxPlayTimeStr,
      progress,
      isActiveTransition,
      handleTransitionEnd,
      handleCopy,
      imgError,
      statusText,
      title,
      showPlayerDetail,
      isPlay,
      togglePlay,
      playNext,
      playPrev,
      handleToMusicLocation,
      isShowPlayerDetail,
      isBuffering,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.player {
  position: relative;
  height: @height-player;
  border-top: 1px solid var(--color-primary-alpha-900);
  box-sizing: border-box;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  contain: strict;
  padding: 6px;
  z-index: 2;
  // box-shadow: 0px 0px 4px rgba(0, 0, 0, 0.1);
  * {
    box-sizing: border-box;
  }

  &:before {
    .mixin-after();
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    background-color: var(--color-main-background);
    opacity: .9;
    z-index: -1;
  }
}

.picContent {
  height: 100%;
  aspect-ratio: 1 / 1;
  position: relative;
  overflow: hidden;

  // color: var(--color-primary);
  // transition: @transition-normal;
  // transition-property: color;
  flex: none;
  opacity: 1;
  transition: opacity @transition-fast;
  // transition-property: opacity;
  display: flex;
  justify-content: center;
  // align-items: center;
  cursor: pointer;

  &:hover {
    opacity: .8;
  }

  // svg {
  //   fill: currentColor;
  // }
  img {
    position: absolute;
    inset: 0;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: @transition-normal;
    transition-property: border-color;
    // border-radius: 50%;
    border-radius: @radius-border;
    // border: 2px solid @color-theme_2-background_1;
  }

  .emptyPic {
    position: absolute;
    inset: 0;
    background-color: var(--color-primary-light-900-alpha-200);
    border-radius: @radius-border;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-primary-light-400-alpha-200);
    user-select: none;
    font-size: 20px;
    font-family: Consolas, "Courier New", monospace;

    span {
      padding-left: 3px;
    }
  }
}

.infoSlot {
  position: relative;
  height: 100%;
  flex: auto;
  min-width: 0;
}

.infoContent {
  position: absolute;
  inset: 0;
  padding: 0 10px;
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: flex-start;
  font-size: 13px;
  color: var(--color-font);
  min-width: 0;
  line-height: 1.5;
}

.title {
  max-width: 100%;
  font-size: 12px;
  color: var(--color-font-label);
  .mixin-ellipsis-1();
}
.status {
  padding-top: 3px;
  height: 23px;
  .mixin-ellipsis-1();
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;

  span {
    .mixin-ellipsis-1();
  }

  &.busyStatus:before {
    content: '';
    flex: none;
    width: 9px;
    height: 9px;
    border: 1px solid var(--color-primary-alpha-700);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: player-buffering .8s linear infinite;
  }
}

// .timeContainer {
//   flex: none;
//   padding: 15px 0;
//   &:hover {
//     .progress {
//       opacity: 1;
//     }
//   }
// }
// .timeContent {
//   // width: 30%;
//   position: relative;
//   // flex: none;
//   color: var(--color-300);
//   font-size: 13px;
//   // padding-left: 10px;
//   // display: flex;
//   // flex-flow: column nowrap;
//   // align-items: center;
//   padding-bottom: 3px;
// }
// .progress {
//   position: absolute;
//   top: 100%;
//   left: 0;
//   width: 100%;
//   flex: auto;
//   // width: 160px;
//   // position: relative;
//   // padding-bottom: 6px;
//   // margin: 0 8px;
//   padding: 2px 0;
//   height: 8px;
//   transition: opacity @transition-normal;
//   opacity: .24;

//   .progressBar {
//     height: 2px;
//     border-radius: 0;
//   }
// }
// .time {
//   display: flex;
//   flex-flow: row nowrap;
//   justify-content: space-between;
// }

.playBtnContent {
  height: 100%;
  flex: none;
  display: flex;
  flex-flow: row nowrap;
  align-items: center;
  padding-left: 10px;
  padding-right: 15px;
  gap: 10px;
}

.playBtn {
  flex: none;
  position: relative;
  width: 34px;
  height: 34px;
  padding: 6px;
  border: none;
  border-radius: var(--radius-md);
  background-color: transparent;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, opacity, transform, box-shadow;
  color: var(--color-button-font);
  opacity: 1;
  cursor: pointer;

  svg {
    position: absolute;
    inset: 20%;
    width: 100%;
    height: 100%;
    fill: currentColor;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    background-color: var(--color-hover);
  }
  &:active {
    opacity: .75;
    transform: scale(.94);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.playBtn > svg {
  width: 60%;
  height: 60%;
}

.primaryPlayBtn {
  width: 42px;
  height: 42px;
  padding: 8px;
  color: var(--color-accent);
  background-color: transparent;
  box-shadow: none;
}

@keyframes player-buffering {
  to { transform: rotate(360deg); }
}

</style>
