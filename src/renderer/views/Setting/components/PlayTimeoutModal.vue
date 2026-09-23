<template lang="pug">
material-modal(:show="modelValue" teleport="#view" @close="handleCloseModal" @after-enter="$refs.dom_input.focus()")
  main(:class="$style.main")
    h2 {{ $t('play_timeout') }}
    div(:class="$style.content")
      div(:class="[$style.row, $style.inputGroup]")
        base-input(ref="dom_input" v-model="time" :class="$style.input" type="number" min="1" max="1440" step="1" :aria-invalid="!!validationError" :aria-describedby="validationError ? 'play-timeout-error' : null" @update:model-value="validationError = ''")
        p(:class="$style.inputLabel") {{ $t('play_timeout_unit') }}
      p#play-timeout-error(v-if="validationError" :class="$style.error" role="alert") {{ validationError }}
      div(:class="$style.row")
        base-checkbox(id="play_timeout_end" :model-value="appSetting['player.waitPlayEndStop']" :label="$t('play_timeout_end')" @update:model-value="updateSetting({'player.waitPlayEndStop': $event})")
      div(:class="[$style.row, $style.tip, { [$style.show]: !!timeLabel }]")
        p {{ $t('play_timeout_tip', { time: timeLabel }) }}
    div(:class="$style.footer")
      base-btn(:class="$style.footerBtn" @click="handleCancel") {{ $t(timeLabel ? 'play_timeout_stop' : 'play_timeout_close') }}
      base-btn(:class="$style.footerBtn" @click="handleConfirm") {{ $t(timeLabel ? 'play_timeout_update' : 'play_timeout_confirm') }}
</template>

<script>
import { useTimeout, startTimeoutStop, stopTimeoutStop } from '@renderer/core/player/timeoutStop'
import { ref } from '@common/utils/vueTools'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { normalizeTimeoutMinutes } from '@renderer/utils/timeoutInput'

const MAX_MIN = 1440

export default {
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const { timeLabel } = useTimeout()
    const time = ref(appSetting['player.waitPlayEndStopTime'])
    const validationError = ref('')

    const handleCloseModal = () => {
      validationError.value = ''
      emit('update:modelValue', false)
    }
    const handleCancel = () => {
      if (timeLabel.value) {
        stopTimeoutStop()
      }
      handleCloseModal()
    }
    const verify = () => {
      const minutes = normalizeTimeoutMinutes(time.value, MAX_MIN)
      if (minutes === null) {
        validationError.value = window.i18n.t('play_timeout_invalid')
        return null
      }
      validationError.value = ''
      time.value = minutes
      return minutes
    }
    const handleConfirm = () => {
      const minutes = verify()
      if (minutes === null) return
      const savedTime = String(minutes)
      if (appSetting['player.waitPlayEndStopTime'] !== savedTime) void updateSetting({ 'player.waitPlayEndStopTime': savedTime })
      startTimeoutStop(minutes * 60)
      handleCloseModal()
    }
    return {
      appSetting,
      updateSetting,
      timeLabel,
      time,
      validationError,
      handleCloseModal,
      handleCancel,
      handleConfirm,
    }
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  max-width: 530px;
  min-width: 280px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  min-height: 0;
  // max-height: 100%;
  // overflow: hidden;
  h2 {
    font-size: 16px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
  }
}
.content {
  padding-top: 15px;
  font-size: 14px;
}
.row {
  padding-top: 5px;
}
.inputGroup {
  display: flex;
  align-items: center;
}
.input {
  flex: auto;
}
.inputLabel {
  flex: none;
  margin-left: 10px;
}
.tip {
  visibility: hidden;

  &.show {
    visibility: visible;
  }
}
.error {
  color: var(--color-danger);
  margin-top: 8px;
}
.footer {
  margin-top: 20px;
  display: flex;
  flex-flow: row nowrap;
}
.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 36px;
  padding: 0 10px !important;
  width: 150px;
  .mixin-ellipsis-1();
  + .footerBtn {
    margin-left: 15px;
  }
}
.ruleLink {
  .mixin-ellipsis-1();
}

</style>
