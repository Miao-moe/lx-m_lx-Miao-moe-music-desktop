<template>
  <div :class="$style.container">
    <AggregateStatus :state="listInfo.aggregate" @retry="retrySource" />
    <div :class="$style.results">
      <SongList
        ref="listRef"
        :streaming="sourceId == 'all'" :list-info="listInfo" :visible-source="sourceId == 'all'" search-on-click
        :hide-retry="!!listInfo.aggregate?.failedSources.length"
        :search-result-type="type" @toggle-page="togglePage" @retry="handleRetry"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { searchText } from '@renderer/store/search/state'
import type { EntityType, SearchSource } from '@renderer/store/search/entity'
import SongList from '@renderer/views/songList/List/components/SongList.vue'
import useList from './useList'
import AggregateStatus from '../components/AggregateStatus.vue'
import { retryFailedSources } from '@renderer/store/search/entity'

const props = defineProps<{
  type: EntityType
  sourceId: SearchSource
  page: number
}>()
const route = useRoute()
const router = useRouter()
const { listRef, listInfo, search } = useList()
const retrySource = async(source?: LX.OnlineSource) => retryFailedSources(props.type, source)

watch(() => [props.type, searchText.value, props.sourceId, props.page] as const, ([type, text, sourceId, page]) => {
  if (!text) return
  search(type, text, sourceId, page || 1)
}, { immediate: true })

const togglePage = (page: number) => {
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      page,
    },
  })
}

const handleRetry = () => {
  if (props.sourceId === 'all' && listInfo.value.aggregate?.failedSources.length) {
    void retryFailedSources(props.type)
    return
  }
  search(props.type, searchText.value, props.sourceId, props.page || 1)
}
</script>

<style lang="less" module>
.container {
  display: flex;
  flex-direction: column;
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  padding-top: 5px;
}
.results { flex: 1; min-height: 0; position: relative; }
</style>
