<template>
  <div v-if="state" :class="$style.notice" role="status" data-search-progress :data-search-failures="state.failedSources.length ? '' : undefined">
    <span>{{ $t('search__progress', { done: state.sources.length - state.pendingSources.length, total: state.sources.length }) }}</span>
    <span v-for="item in state.sources" :key="item.source" :class="$style.platform" :data-search-platform="item.source">
      <span>{{ sourceName(item.source) }} · {{ item.status === 'loading' ? $t('list__loading') : `${(item.elapsedMs / 1000).toFixed(1)}s` }}</span>
      <span v-if="item.status === 'failed'" data-search-failed>{{ $t('list__load_failed') }}</span>
      <base-btn v-if="item.status === 'failed'" min :data-retry-source="item.source" @click="$emit('retry', item.source)">{{ $t('reload') }}</base-btn>
    </span>
    <span v-if="state.failedSources.length" data-failed-sources>{{ $t('search__failed_sources', { sources: failedSourceNames }) }}</span>
    <base-btn
      v-if="state.failedSources.length > 1"
      min :disabled="state.pendingSources.length > 0" data-retry-failed-sources
      @click="$emit('retry')"
    >{{ $t('search__retry_failed') }}</base-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from '@common/utils/vueTools'
import { sourceNames } from '@renderer/store'
import type { AggregateSearchState } from '@renderer/store/search/aggregate'

const props = defineProps<{ state?: AggregateSearchState }>()
defineEmits<{ retry: [source?: LX.OnlineSource] }>()
const sourceName = (source: LX.OnlineSource) => sourceNames.value[source] || source
const failedSourceNames = computed(() => props.state?.failedSources.map((source: LX.OnlineSource) => sourceNames.value[source]).join('、') ?? '')
</script>

<style lang="less" module>
.notice {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 15px;
  color: var(--color-font);
  font-size: 13px;
  line-height: 1.5;
}
.platform { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
.platform [data-search-failed] { flex: 1 1 240px; }
</style>
