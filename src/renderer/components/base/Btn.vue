<template>
  <button
    :class="[$style.btn, {[$style.min]: min}, {[$style.outline]: outline}]"
    tabindex="0"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<script>
export default {
  props: {
    min: {
      type: Boolean,
    },
    outline: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.btn {
  display: inline-block;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  padding: 8px 15px;
  color: var(--color-button-font);
  outline: none;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: color, background-color, box-shadow, transform;
  background-color: var(--color-button-background);
  font-size: 14px;
  &[disabled] {
    opacity: .4;
    cursor: not-allowed;
  }

  &.outline {
    background-color: transparent;
  }

  &:not([disabled]):hover {
    background-color: var(--color-button-background-hover);
  }
  &:not([disabled]):active {
    background-color: var(--color-button-background-active);
    transform: scale(.98);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.min {
  padding: 3px 8px;
  font-size: 12px;
}

</style>
