<template>
  <material-popup-btn :class="$style.btnContent">
    <button :class="[$style.btn, { [$style.active]: isMute }]" :aria-label="isMute ? $t('player__volume_muted') : `${$t('player__volume')}${displayVolumePercent}%`" @wheel.prevent="handleWheel">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve">
        <use :xlink:href="icon" />
      </svg>
    </button>
    <template #content>
      <div :class="$style.setting" @wheel.prevent="handleWheel">
        <div :class="$style.info">
          <span>{{ displayVolumePercent }}%</span>
          <base-checkbox
            id="player__volume_mute"
            :model-value="isMute"
            :label="$t('player__volume_mute_label')"
            @update:model-value="saveVolumeIsMute($event)"
          />
        </div>
        <base-slider-bar :class="$style.slider" :value="volume * maxVolume" :min="0" :max="maxVolume" :step="0.001" @change="handleUpdateVolume" />
      </div>
    </template>
  </material-popup-btn>
</template>

<script setup>
import { computed, onBeforeUnmount } from '@common/utils/vueTools'
import { saveVolumeIsMute, appSetting } from '@renderer/store/setting'
import { volume, isMute } from '@renderer/store/player/volume'

const VOLUME_FINE_STEP = 0.001
const maxVolume = computed(() => appSetting['player.maxVolume'] ?? 1)
const volumePercent = computed(() => Math.round(volume.value * maxVolume.value * 1000) / 10)
const displayVolumePercent = computed(() => Math.trunc(volumePercent.value))

let targetVolume = null
let volumeFrameId = null

const stopVolumeTransition = () => {
  if (volumeFrameId != null) cancelAnimationFrame(volumeFrameId)
  volumeFrameId = null
  targetVolume = null
}

const updateVolume = () => {
  if (targetVolume == null) return
  const currentVolume = volume.value * maxVolume.value
  const distance = targetVolume - currentVolume
  const absoluteDistance = Math.abs(distance)

  if (absoluteDistance <= VOLUME_FINE_STEP) {
    window.app_event.setVolume(targetVolume / maxVolume.value)
    volumeFrameId = null
    targetVolume = null
    return
  }

  // A compact track skips pointer positions, so fill small gaps one 0.1% step per frame.
  const step = absoluteDistance <= 0.01
    ? VOLUME_FINE_STEP
    : Math.max(VOLUME_FINE_STEP, absoluteDistance * 0.3)
  const nextVolume = currentVolume + Math.sign(distance) * Math.min(absoluteDistance, step)
  const steppedVolume = Math.round(nextVolume / VOLUME_FINE_STEP) * VOLUME_FINE_STEP
  window.app_event.setVolume(steppedVolume / maxVolume.value)
  volumeFrameId = requestAnimationFrame(updateVolume)
}

const handleWheel = (event) => {
  if (event.deltaY == 0) return
  stopVolumeTransition()
  const percent = event.deltaY > 0
    ? Math.ceil(volumePercent.value) - 1
    : Math.floor(volumePercent.value) + 1
  const targetPercent = Math.max(0, Math.min(maxVolume.value * 100, percent))
  window.app_event.setVolume(targetPercent / 100 / maxVolume.value)
}

const handleUpdateVolume = (val) => {
  targetVolume = val
  if (volumeFrameId == null) volumeFrameId = requestAnimationFrame(updateVolume)
}

onBeforeUnmount(stopVolumeTransition)

const icon = computed(() => {
  return isMute.value
    ? '#icon-volume-mute-outline'
    : volume.value == 0
      ? '#icon-volume-off-outline'
      : volume.value < 0.3
        ? '#icon-volume-low-outline'
        : volume.value < 0.7
          ? '#icon-volume-medium-outline'
          : '#icon-volume-high-outline'
})

</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';
.btnContent {
  flex: none;
  height: 100%;
}

.btn {
  position: relative;
  // color: var(--color-button-font);
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-sm);
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, box-shadow, transform;
  cursor: pointer;
  background-color: transparent;
  border: none;
  width: 24px;
  display: flex;
  flex-flow: column nowrap;
  padding: 0;

  svg {
    transition: opacity @transition-fast;
    opacity: .6;
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.2));
  }
  &:hover {
    background-color: var(--color-hover);
    svg {
      opacity: .9;
    }
  }
  &:active {
    transform: scale(.94);
    svg {
      opacity: 1;
    }
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
  &.active {
    color: var(--color-accent);
    background-color: var(--color-selected);
  }
}

.setting {
  display: flex;
  flex-flow: column nowrap;
  padding: 2px 3px;
  gap: 8px;
  width: 140px;
}

.info {
  display: flex;
  flex-flow: row nowrap;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  span {
    line-height: 1.2;
  }
}

.slider {
  width: 100%;
}

</style>
