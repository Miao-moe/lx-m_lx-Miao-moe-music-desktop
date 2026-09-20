<template>
  <div :class="$style.container">
    <AggregateStatus :state="listInfo.aggregate" @retry="retryFailedSources" />
    <div :class="$style.results">
    <material-online-list
      ref="listRef"
      :page="listInfo.page"
      :limit="listInfo.limit"
      :total="listInfo.total"
      :list="listInfo.list"
      :no-item="listInfo.noItemLabel"
      :hide-retry="!!listInfo.aggregate?.failedSources.length"
      :source-tag="sourceId == 'all'"
      check-api-source
      @toggle-page="handleTogglePage"
      @play-list="handlePlayList"
      @retry="handleRetry"
    />
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from '@common/utils/vueTools'
import { searchText } from '@renderer/store/search/state'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import useList, { type SearchSource } from './useList'
import AggregateStatus from '../components/AggregateStatus.vue'
import { retryFailedSources } from '@renderer/store/search/music'

interface Props {
  sourceId: SearchSource
  page: number
}

const props = defineProps<Props>()
const router = useRouter()
const route = useRoute()

const {
  listRef,
  listInfo,
  search,
  handlePlayList,
} = useList()

watch(() => [searchText.value, props.sourceId, props.page] as const, ([text, sourceId, page]) => {
  if (!text) return
  search(text, sourceId, page || 1)
}, {
  immediate: true,
})

const handleTogglePage = (page: number) => {
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
    void retryFailedSources()
    return
  }
  search(searchText.value, props.sourceId, props.page || 1)
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
}

.results { flex: 1; min-height: 0; position: relative; }

.list {
  overflow: hidden;
  height: 100%;
  flex: auto;
}

</style>
