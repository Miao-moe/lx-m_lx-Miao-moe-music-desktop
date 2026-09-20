<template>
  <component
    :is="tag" v-show="rendered" ref="panel" :class="$style.root" :style="{ gridTemplateRows: expanded ? '1fr' : '0fr', opacity: expanded ? 1 : 0 }"
    data-setting-reveal :data-setting-search-depends="depends || undefined" :aria-hidden="!show || undefined" :inert="show ? null : ''"
    @transitionend="handleTransitionEnd"
  >
    <div :class="$style.content" :style="{ overflow: expanded && !moving ? 'visible' : 'hidden' }" data-setting-reveal-content><slot /></div>
  </component>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { getMotionDuration } from '@renderer/utils/motion'

const props = defineProps({
  show: { type: Boolean, required: true },
  tag: { type: String, default: 'div' },
  depends: { type: String, default: '' },
})
const panel = ref<HTMLElement | null>(null)
const expanded = ref(props.show)
const rendered = ref(props.show)
const moving = ref(false)
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const motionDuration = () => reducedMotion.matches ? 0 : getMotionDuration('normal')

const settle = () => {
  clearTimeout(timer)
  moving.value = false
  rendered.value = props.show
}
const scheduleSettle = () => {
  clearTimeout(timer)
  const duration = motionDuration()
  if (!duration) settle()
  else timer = setTimeout(settle, duration + 80)
}
const handleTransitionEnd = (event: TransitionEvent) => {
  if (event.target === panel.value && event.propertyName === 'grid-template-rows') settle()
}
const handleMotionChange = () => {
  const duration = motionDuration()
  if (!duration) {
    expanded.value = props.show
    settle()
  } else if (moving.value) {
    scheduleSettle()
  }
}

watch(() => props.show, async(show: boolean) => {
  const token = ++revision
  clearTimeout(timer)
  const element = panel.value
  if (!show && element?.contains(document.activeElement)) {
    const control = props.depends.split(/\s+/).map((id: string) => document.getElementById(id))
      .map((control: HTMLElement | null) => control instanceof HTMLInputElement
        ? control.labels?.[0]?.querySelector<HTMLElement>('[role="checkbox"], [role="radio"]') ?? control
        : control)
      .find((control: HTMLElement | null) => control && !control.closest('[inert]') && control.getClientRects().length)
    control?.focus()
    if (element.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur()
  }
  moving.value = true
  if (show) {
    rendered.value = true
    await nextTick()
    if (token !== revision) return
    // Establish the collapsed grid before opening a previously hidden panel.
    panel.value?.getBoundingClientRect()
  }
  expanded.value = show
  scheduleSettle()
}, { flush: 'pre' })

onMounted(() => {
  window.addEventListener('lx-motion-change', handleMotionChange)
  reducedMotion.addEventListener('change', handleMotionChange)
})
onBeforeUnmount(() => {
  ++revision
  clearTimeout(timer)
  window.removeEventListener('lx-motion-change', handleMotionChange)
  reducedMotion.removeEventListener('change', handleMotionChange)
})
</script>

<style lang="less" module>
.root {
  display: grid;
  min-width: 0;
  transition: grid-template-rows var(--duration-normal) var(--ease-standard), opacity var(--duration-normal) var(--ease-standard);
}
.root > .content { min-height: 0; min-width: 0; overflow: hidden; padding: 0; }
dd.root > .content > div { padding: 0 var(--setting-inset, 15px); }
@media (prefers-reduced-motion: reduce) {
  .root { transition: none; }
}
</style>
