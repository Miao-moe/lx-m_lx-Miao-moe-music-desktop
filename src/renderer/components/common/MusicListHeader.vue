<template>
  <div ref="header" class="thead" :class="$style.header" :data-music-columns="layout.key">
    <table ref="table" :class="$style.table">
      <thead>
        <tr>
          <th
            v-for="(column, index) in layout.columns" :key="column.id" :data-music-column="column.id"
            :style="{ width: `var(--music-column-${column.id})` }" :class="{ [$style.center]: column.id == 'index' || column.id == 'cover' }" scope="col"
          >
            <span :class="$style.label">{{ column.id == 'index' ? '#' : column.id == 'action' && actionLabel ? actionLabel : $t(column.label) }}</span>
            <span
              v-if="index < layout.columns.length - 1" :class="[$style.handle, { [$style.active]: resizingIndex == index }]"
              role="separator" tabindex="0" aria-orientation="vertical" :aria-label="$t('list__column_width', { name: column.id == 'index' ? '#' : column.id == 'action' && actionLabel ? actionLabel : $t(column.label) })"
              :aria-valuenow="Math.round(layout.widths[index])" :aria-valuemin="Math.round(layout.minimums[index])"
              :aria-valuemax="Math.round(layout.widths[index] + remainingSpace(layout.widths, index))"
              :title="$t('list__column_resize_tip')" :data-column-resize="column.id"
              @pointerdown="startResize($event, index)" @pointermove="moveResize" @pointerup="endResize"
              @pointercancel="cancelResize" @lostpointercapture="cancelResize" @dblclick.stop.prevent="reset"
              @keydown="onKeyDown($event, index)" @keyup.stop @click.stop
            />
          </th>
        </tr>
      </thead>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { PropType } from 'vue'
import { ref, watch, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
import type { MusicColumnLayout } from '@renderer/utils/compositions/useMusicListColumns'

const props = defineProps({
  layout: { type: Object as PropType<MusicColumnLayout>, required: true },
  actionLabel: { type: String, default: '' },
})
const header = ref<HTMLDivElement>()
const table = ref<HTMLTableElement>()
const resizingIndex = ref(-1)
let observer: ResizeObserver | undefined
let pointer: { id: number, x: number, index: number, widths: number[], target: HTMLElement } | null = null
const remainingSpace = (widths: number[], index: number) => widths.slice(index + 1).reduce((sum, width, offset) => sum + Math.max(0, width - props.layout.minimums[index + 1 + offset]), 0)
const adjustedWidths = (widths: number[], index: number, delta: number) => {
  const next = [...widths]
  const change = Math.max(props.layout.minimums[index] - widths[index], Math.min(remainingSpace(widths, index), delta))
  next[index] += change
  if (change < 0) next[index + 1] -= change
  else {
    // A fixed-size cover or a narrow neighbor must not prevent earlier columns from growing.
    let remaining = change
    for (let i = index + 1; i < next.length && remaining > 0; i++) {
      const take = Math.min(remaining, Math.max(0, widths[i] - props.layout.minimums[i]))
      next[i] -= take
      remaining -= take
    }
  }
  return next
}
const stop = () => {
  const previous = pointer
  pointer = null
  resizingIndex.value = -1
  document.documentElement.classList.remove('music-column-resizing')
  if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
}
const cancelResize = () => {
  if (!pointer) return
  stop()
  props.layout.preview(null)
}
const startResize = (event: PointerEvent, index: number) => {
  event.stopPropagation()
  if (event.button != 0 || !event.isPrimary || pointer != null || !props.layout.availableWidth) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  pointer = { id: event.pointerId, x: event.clientX, index, widths: [...props.layout.widths], target }
  target.setPointerCapture(event.pointerId)
  target.focus()
  resizingIndex.value = index
  document.documentElement.classList.add('music-column-resizing')
}
const moveResize = (event: PointerEvent) => {
  if (!pointer || event.pointerId != pointer.id) return
  props.layout.preview(adjustedWidths(pointer.widths, pointer.index, event.clientX - pointer.x))
}
const endResize = (event: PointerEvent) => {
  if (!pointer || event.pointerId != pointer.id) return
  const widths = adjustedWidths(pointer.widths, pointer.index, event.clientX - pointer.x)
  stop()
  void props.layout.persist(widths)
}
const reset = () => { cancelResize(); void props.layout.persist(null) }
const onKeyDown = (event: KeyboardEvent, index: number) => {
  event.stopPropagation()
  if (event.key == 'Escape') { event.preventDefault(); cancelResize(); return }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  cancelResize()
  const step = event.shiftKey ? 1 : 8
  const delta = event.key == 'Home' ? -Infinity : event.key == 'End' ? Infinity : event.key == 'ArrowLeft' ? -step : step
  void props.layout.persist(adjustedWidths(props.layout.widths, index, delta))
}
watch(() => [props.layout.key, props.layout.availableWidth], cancelResize, { flush: 'sync' })
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (!table.value) return
    // Measure the available space, not a table whose intrinsic width depends on its columns.
    props.layout.measure(entry.contentRect.width, parseFloat(getComputedStyle(table.value.querySelector('th')!).fontSize) / 12)
  })
  if (header.value) observer.observe(header.value)
  window.addEventListener('blur', cancelResize)
})
onBeforeUnmount(() => { cancelResize(); observer?.disconnect(); window.removeEventListener('blur', cancelResize) })
</script>

<style lang="less" module>
.header { min-width: 0; width: 100%; box-sizing: border-box; contain: inline-size; }
.table {
  table-layout: fixed;
  th { position: relative; box-sizing: border-box; min-width: 0; }
  .center { text-align: center; }
}
.label { display: block; padding-right: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.handle {
  position: absolute;
  z-index: 1;
  top: 4px;
  right: 0;
  bottom: 4px;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
  -webkit-app-region: no-drag;
  &::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 1px; background: var(--color-primary); opacity: .15; }
  &:hover::after, &:focus-visible::after, &.active::after { opacity: .85; }
  &:focus-visible { box-shadow: inset var(--focus-ring); }
}
</style>

<style lang="less">
.music-column-scroll { scrollbar-gutter: stable; }
.music-column-resizing, .music-column-resizing * { cursor: col-resize !important; user-select: none !important; }
</style>
