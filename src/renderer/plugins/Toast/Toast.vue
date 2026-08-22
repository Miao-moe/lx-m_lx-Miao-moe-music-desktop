<template>
  <transition name="toast-fade" @after-leave="afterLeave">
    <div v-show="visible" :class="$style.toast" role="presentation">{{ message }}</div>
  </transition>
</template>

<script>
export default {
  props: {
    afterLeave: {
      type: Function,
      default: () => {},
    },
  },
  data() {
    return {
      visible: false,
      message: '',
    }
  },
  beforeUnmount() {
    const el = this.$el
    el.parentNode?.removeChild(el)
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
:global(.toast-fade-enter-active), :global(.toast-fade-leave-active) {
  transition: var(--duration-normal) var(--ease-standard);
  transition-property: opacity, transform;
}
:global(.toast-fade-enter-from), :global(.toast-fade-leave-to) {
  opacity: 0;
  transform: translate(-50%, calc(-50% + 4px));
}

</style>
