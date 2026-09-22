<template>
  <div :class="$style.container" data-list-loading :aria-busy="immediate ? !!loading : !ready">
    <div :class="[$style.content, { [$style.pending]: hidden }]" :aria-hidden="hidden || undefined" :inert="hidden || undefined">
      <slot />
    </div>
    <div v-if="!ready && !immediate" :class="[$style.status, 'ui-state']" role="status">
      <span class="ui-spinner" />
      <p>{{ $t('list__loading') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import useListLoading from '@renderer/utils/compositions/useListLoading'

const props = defineProps<{
  loadKey: unknown
  loading?: boolean
  streaming?: boolean
}>()
const immediate = computed(() => props.streaming || appSetting['list.loadingMode'] === 'immediate')
const ready = useListLoading([() => props.loadKey, () => props.loading, () => props.streaming], () => !!props.loading, () => immediate.value)
const hidden = computed(() => !ready.value || (immediate.value && props.loading && Array.isArray(props.loadKey) && !props.loadKey.length))
</script>

<style lang="less" module>
.container, .content {
  position: relative;
  display: flex;
  flex-flow: column nowrap;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.content {
  flex: auto;
}
.pending {
  visibility: hidden;
  pointer-events: none;
}
.status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;
  text-align: center;
}
</style>
