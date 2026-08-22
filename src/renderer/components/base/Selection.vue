<template>
  <div class="content" :class="[$style.select, show ? $style.active : '']">
    <div
      ref="dom_btn" class="label-content" :class="$style.label" role="combobox" tabindex="0"
      :aria-expanded="show" @click="handleShow" @keydown.enter.space.prevent="handleShow" @keydown.esc.prevent="handleKeyboardHide"
    >
      <span class="label">{{ label }}</span>
      <div class="icon" :class="$style.icon">
        <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" height="100%" viewBox="0 0 451.847 451.847" space="preserve">
          <use xlink:href="#icon-down" />
        </svg>
      </div>
    </div>
    <ul v-if="show" ref="dom_list" class="selection-list scroll" :class="$style.list" :style="listStyles">
      <li
        v-for="(item, index) in list" :key="index" :class="[$style.listItem, (itemKey ? item[itemKey] : item) == modelValue ? $style.active : null]"
        tabindex="0" :aria-label="itemName ? item[itemName] : item" @click="handleClick(item)" @keydown.enter.space.prevent="handleClick(item)"
      >
        {{ itemName ? item[itemName] : item }}
      </li>
    </ul>
  </div>
</template>

<script>

export default {
  props: {
    list: {
      type: Array,
      default() {
        return []
      },
    },
    modelValue: {
      type: [String, Number],
      required: true,
    },
    itemName: {
      type: String,
      default: '',
    },
    itemKey: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue', 'change'],
  data() {
    return {
      show: false,
      listStyles: {
        transform: 'scaleY(0) translateY(0)',
      },
    }
  },
  computed: {
    activeIndex() {
      if (this.modelValue == null) return -1
      if (!this.itemName) return this.list.indexOf(this.modelValue)
      return this.list.findIndex(l => l[this.itemKey] == this.modelValue)
    },
    label() {
      if (this.modelValue == null) return ''
      if (this.itemName == null) return this.modelValue
      const item = this.list[this.activeIndex]
      if (!item) return ''
      return item[this.itemName]
    },
  },
  mounted() {
    document.addEventListener('click', this.handleHide, true)
  },
  beforeUnmount() {
    document.removeEventListener('click', this.handleHide, true)
  },
  methods: {
    handleHide(e) {
      if (!this.show) return
      // if (e && e.target.parentNode != this.$refs.dom_list && this.show) return this.show = false
      if (e && (e.target == this.$refs.dom_btn || this.$refs.dom_btn.contains(e.target))) return
      this.listStyles.transform = 'scaleY(0) translateY(0)'
      setTimeout(() => {
        this.show = false
      }, 50)
    },
    handleKeyboardHide() {
      if (!this.show) return
      this.listStyles.transform = 'scaleY(0) translateY(0)'
      setTimeout(() => {
        this.show = false
      }, 50)
    },
    handleClick(item) {
      // console.log(this.modelValue)
      if (item === this.modelValue) return
      this.$emit('update:modelValue', this.itemKey ? item[this.itemKey] : item)
      this.$emit('change', item)
    },
    handleShow() {
      this.show = true
      this.$nextTick(() => {
        this.listStyles.transform = `scaleY(1) translateY(${this.handleGetOffset()}px)`

        const activeItem = this.$refs.dom_list.children[this.activeIndex]
        if (activeItem) this.$refs.dom_list.scrollTop = activeItem.offsetTop - this.$refs.dom_list.clientHeight * 0.38
      })
    },
    handleGetOffset() {
      const listHeight = this.$refs.dom_list.clientHeight
      const dom_select = this.$refs.dom_list.offsetParent
      const dom_container = dom_select.offsetParent
      const containerHeight = dom_container.clientHeight
      if (containerHeight < listHeight) return 0
      const offsetHeight = (dom_container.scrollTop + containerHeight) - (dom_select.offsetTop + listHeight)
      if (offsetHeight > 0) return 0
      return offsetHeight - 5
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@selection-height: 28px;

.select {
  display: inline-block;
  font-size: 12px;
  position: relative;
  width: var(--selection-width, 300px);

  &.active {
    .label {
      background-color: var(--color-button-background);
    }
    .list {
      opacity: 1;
    }
    .icon {
      svg{
        transform: rotate(180deg);
      }
    }
  }
}

.label {
  background-color: var(--color-button-background);
  padding: 0 10px;
  transition: var(--duration-fast) var(--ease-standard);
  transition-property: background-color, box-shadow;
  height: @selection-height;
  // line-height: 27px;
  line-height: 1.5;
  box-sizing: border-box;
  color: var(--color-button-font);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;

  span {
    flex: auto;
    .mixin-ellipsis-1();
  }
  .icon {
    flex: none;
    margin-left: 7px;
    line-height: 0;
    svg {
      width: 1em;
      transition: transform var(--duration-fast) var(--ease-standard);
      transform: rotate(0);
    }
  }

  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
  }
}

.list {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  background-color: var(--color-surface-elevated);
  opacity: 0;
  transform: scaleY(0) translateY(0);
  transform-origin: 0 (@selection-height / 2) 0;
  transition: var(--duration-normal) var(--ease-standard);
  transition-property: transform, opacity;
  z-index: 10;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-popup);
  overflow: auto;
  max-height: 200px;
}
.listItem {
  cursor: pointer;
  padding: 0 10px;
  line-height: @selection-height;
  // color: var(--color-button-font);
  outline: none;
  transition: background-color var(--duration-fast) var(--ease-standard);
  background-color: transparent;
  box-sizing: border-box;
  .mixin-ellipsis-1();

  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:active {
    background-color: var(--color-button-background-active);
  }
  &.active {
    color: var(--color-accent);
    background-color: var(--color-selected);
  }
  &:focus-visible {
    box-shadow: inset var(--focus-ring);
  }
}


</style>
