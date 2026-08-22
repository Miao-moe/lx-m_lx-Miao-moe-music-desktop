<template>
  <material-popup-btn :class="$style.btnContent">
    <button :class="[$style.btn, { [$style.active]: isMute }]" :aria-label="isMute ? $t('player__volume_muted') : `${$t('player__volume')}${Math.trunc(volume * maxVolume * 100)}%`" @wheel.prevent="handleWheel">
      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" width="100%" viewBox="0 0 24 24" space="preserve">
        <use :xlink:href="icon" />
      </svg>
    </button>
    <template #content>
      <div :class="$style.setting" @wheel.prevent="handleWheel">
        <div :class="$style.info">
          <span>{{ Math.trunc(volume * maxVolume * 100) }}%</span>
          <base-checkbox
            id="player__volume_mute"
            :model-value="isMute"
            :label="$t('player__volume_mute_label')"
            @update:model-value="saveVolumeIsMute($event)"
          />
        </div>
        <base-slider-bar :class="$style.slider" :value="volume * maxVolume" :min="0" :max="maxVolume" :step="0.01" @change="handleUpdateVolume" />
      </div>
    </template>
  </material-popup-btn>
</template>

<script setup>
import { computed } from '@common/utils/vueTools'
import { saveVolumeIsMute, appSetting } from '@renderer/store/setting'
import { volume, isMute } from '@renderer/store/player/volume'

const maxVolume = computed(() => appSetting['player.maxVolume'] ?? 1)

const handleWheel = (event) => {
  const step = 0.01
  const delta = event.deltaY > 0 ? -step : step
  window.app_event.setVolume(Math.max(0, Math.min(1, volume.value + delta)))
}

const handleUpdateVolume = (val) => {
  window.app_event.setVolume(val / maxVolume.value)
}

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
