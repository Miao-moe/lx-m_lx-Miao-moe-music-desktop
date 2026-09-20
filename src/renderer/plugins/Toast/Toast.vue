<template>
  <transition name="toast-fade" @after-leave="afterLeave">
    <div
      v-show="visible" :class="[$style.toast, { [$style.actionable]: actionText }]" role="status" aria-live="polite"
      @mouseenter="pause" @mouseleave="resume" @focusin="pause" @focusout="resume"
    >
      <span>{{ message }}</span>
      <button v-if="actionText" type="button" :disabled="busy" @click="handleAction">{{ actionText }}</button>
    </div>
  </transition>
</template>

<script>
export default {
  props: {
    actionText: { type: String, default: '' },
    onAction: { type: Function, default: () => {} },
    pause: { type: Function, default: () => {} },
    resume: { type: Function, default: () => {} },
    afterLeave: {
      type: Function,
      default: () => {},
    },
  },
  data() {
    return {
      visible: false,
      message: '',
      busy: false,
    }
  },
  beforeUnmount() {
    const el = this.$el
    el.parentNode?.removeChild(el)
  },
  methods: {
    async handleAction() {
      if (this.busy) return
      this.busy = true
      try { await this.onAction() } finally { this.busy = false }
    },
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.toast {
  position: fixed;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 10002;
  font-size: 13px;
  line-height: 1.4;
  padding: 8px 16px;
  color: var(--color-font);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface-elevated);
  box-shadow: var(--shadow-popup);
  pointer-events: none;
  white-space: nowrap;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actionable {
  top: auto;
  bottom: 88px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 16px;
  white-space: normal;
  pointer-events: auto;
  button {
    flex: none;
    padding: 6px 10px;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--color-primary);
    background: var(--color-primary-background-hover);
    font: inherit;
    cursor: pointer;
    &:focus-visible { box-shadow: var(--focus-ring); }
    &:disabled { opacity: .6; cursor: wait; }
  }
  &:global(.toast-fade-enter-from), &:global(.toast-fade-leave-to) {
    transform: translate(-50%, 4px);
  }
}
:global(.toast-fade-enter-active), :global(.toast-fade-leave-active) {
  transition: var(--duration-normal) var(--ease-standard);
  transition-property: opacity, transform;
}
:global(.toast-fade-enter-from), :global(.toast-fade-leave-to) {
  opacity: 0;
  transform: translate(-50%, calc(-50% + 4px));
}

</style>
