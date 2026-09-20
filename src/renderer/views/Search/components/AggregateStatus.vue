<template>
  <div v-if="state?.failedSources.length" :class="$style.notice" role="status" data-search-failures>
    <span>{{ $t(state.pendingSources.length ? 'list__loading' : state.status === 'failed' ? 'search__all_failed' : 'search__partial_failed') }}</span>
    <span data-failed-sources>{{ $t('search__failed_sources', { sources: failedSourceNames }) }}</span>
    <base-btn
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
defineEmits<{ retry: [] }>()
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
</style>
