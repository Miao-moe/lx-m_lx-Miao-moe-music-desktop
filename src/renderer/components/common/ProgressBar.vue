<template>
  <div :class="[$style.progress, className]">
    <div :class="[$style.progressBar, $style.progressBar2, {[$style.barTransition]: isActiveTransition}]" :style="{ transform: `scaleX(${progress || 0})` }" @transitionend="handleTransitionEnd" />
    <div v-show="dragging" :class="[$style.progressBar, $style.progressBar3]" :style="{ transform: `scaleX(${dragProgress || 0})` }" />
  </div>
  <div
    ref="dom_progress" :class="$style.progressMask" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"
    :aria-valuenow="Math.round((progress || 0) * 100)" @mousedown="handleMsDown"
    @keydown.left.down.prevent="handleKeyStep(-5)" @keydown.right.up.prevent="handleKeyStep(5)"
  />
</template>

<script>
import { ref, onBeforeUnmount } from '@common/utils/vueTools'
import { playProgress } from '@renderer/store/player/playProgress'

export default {
  props: {
    className: {
      type: String,
      default: '',
    },
    progress: {
      type: Number,
      required: true,
    },
    isActiveTransition: {
      type: Boolean,
      required: true,
    },
    handleTransitionEnd: {
      type: Function,
      required: true,
    },
  },
  setup(props) {
    const msEvent = {
      isMsDown: false,
      msDownX: 0,
      msDownProgress: 0,
    }
    const dom_progress = ref(null)
    const dragging = ref(false)
    const dragProgress = ref(0)

    const handleMsDown = event => {
      msEvent.isMsDown = true
      msEvent.msDownX = event.clientX

      let val = event.offsetX / dom_progress.value.clientWidth
      if (val < 0) val = 0
      if (val > 1) val = 1

      dragProgress.value = msEvent.msDownProgress = val
    }
    const handleMsUp = () => {
      if (msEvent.isMsDown) setProgress(dragProgress.value * playProgress.maxPlayTime)
      msEvent.isMsDown = false
      dragging.value = false
    }
    const handleMsMove = event => {
      if (!msEvent.isMsDown) return
      dragging.value ||= true

      let progress = msEvent.msDownProgress + (event.clientX - msEvent.msDownX) / dom_progress.value.clientWidth
      if (progress > 1) progress = 1
      else if (progress < 0) progress = 0
      dragProgress.value = progress
    }

    document.addEventListener('mousemove', handleMsMove)
    document.addEventListener('mouseup', handleMsUp)
    onBeforeUnmount(() => {
      document.removeEventListener('mousemove', handleMsMove)
      document.removeEventListener('mouseup', handleMsUp)
    })

    const setProgress = num => {
      window.app_event.setProgress(num)
    }
    const handleKeyStep = seconds => {
      const currentTime = (props.progress || 0) * playProgress.maxPlayTime
      setProgress(Math.max(0, Math.min(playProgress.maxPlayTime, currentTime + seconds)))
    }

    // const handleSetProgress = event => {
    //   // setProgress(event.offsetX / dom_progress.value.clientWidth * playProgress.maxPlayTime)
    // }

    return {
      dom_progress,
      // handleSetProgress,
      dragging,
      dragProgress,
      handleMsDown,
      handleKeyStep,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.progress {
  width: 100%;
  height: 5px;
  overflow: hidden;
  transform-origin: 50% 50%;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: background-color, transform;
  background-color: var(--color-primary-light-100-alpha-800);
  // background-color: #f5f5f5;
  position: relative;
  border-radius: 40px;

  &:has(+ .progressMask:hover),
  &:has(+ .progressMask:focus-visible) {
    transform: scaleY(1.35);
  }
}
.progressMask {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
  border-radius: var(--radius-sm);

  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}
.progressBar {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  transform-origin: 0;
}
.progressBar1 {
  background-color: var(--color-primary-light-100-alpha-600);
}

.progressBar2 {
  background-color: var(--color-accent);
  will-change: transform;
}

.progressBar3 {
  background-color: var(--color-primary-alpha-200);
  opacity: .7;
}

.barTransition {
  transition-property: transform;
  transition-timing-function: var(--ease-standard);
  transition-duration: var(--duration-fast);
}

</style>
