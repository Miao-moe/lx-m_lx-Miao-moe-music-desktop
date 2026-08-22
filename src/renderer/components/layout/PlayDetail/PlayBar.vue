<template>
  <div :class="$style.footer">
    <div :class="$style.footerLeft">
      <control-btns />
      <div :class="$style.progressContainer">
        <div :class="$style.progressContent">
          <common-progress-bar
            :class-name="$style.progress"
            :progress="progress"
            :handle-transition-end="handleTransitionEnd"
            :is-active-transition="isActiveTransition"
          />
        </div>
      </div>
      <div :class="$style.timeLabel"><span :class="$style.status" style="margin-right: 15px">{{ status }}</span><span>{{ nowPlayTimeStr }}</span><span style="margin: 0 5px;">/</span><span>{{ maxPlayTimeStr }}</span></div>
    </div>
    <div :class="$style.playControl">
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

<script setup>
import { playNext, playPrev, togglePlay } from '@renderer/core/player'
import { status, isPlay } from '@renderer/store/player/state'
import usePlayProgress from '@renderer/utils/compositions/usePlayProgress'

import ControlBtns from './components/ControlBtns.vue'

const {
  nowPlayTimeStr,
  maxPlayTimeStr,
  progress,
  isActiveTransition,
  handleTransitionEnd,
} = usePlayProgress()

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.footer {
  flex: 0 0 100px;
  overflow: hidden;
  display: flex;
  align-items: center;
}
.footerLeft {
  flex: auto;
  display: flex;
  flex-flow: column nowrap;
  padding: 13px 13px 13px 30px;
  overflow: hidden;
}

.progressContainer {
  width: 100%;
  position: relative;
  padding: 3px 0;
}

.progressContent {
  position: relative;
  height: 16px;
  padding: 5px 0;
  width: 100%;
}
.progress {
  height: 100%;
}

.barTransition {
  transition-property: transform;
  transition-timing-function: ease-out;
  transition-duration: 0.2s;
}
.timeLabel {
  width: 100%;
  height: 18px;
  display: flex;
  font-variant-numeric: tabular-nums;
  span {
    font-size: 13px;
  }
}
.status {
  flex: auto;
}

.playControl {
  flex: none;
  height: 100%;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  padding: 0 25px;
  color: var(--color-button-font);
  gap: 10px;
}
.playBtn {
  position: relative;
  width: 40px;
  height: 40px;
  padding: 7px;
  border: none;
  border-radius: var(--radius-md);
  background-color: transparent;
  cursor: pointer;
  flex: none;
  // transition: @transition-normal;
  // transition-property: color;
  color: var(--color-button-font);
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, opacity, transform, box-shadow;
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
  width: 48px;
  height: 48px;
  padding: 10px;
  color: var(--color-accent);
  background-color: transparent;
  box-shadow: none;
}

</style>
