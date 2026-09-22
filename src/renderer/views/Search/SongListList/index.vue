<template>
  <div :class="$style.container">
    <AggregateStatus :state="listInfo.aggregate" @retry="retryFailedSources" />
    <div :class="$style.results">
      <SongList
        ref="listRef"
        :streaming="sourceId == 'all'" :list-info="listInfo" :visible-source="sourceId == 'all'"
        :hide-retry="!!listInfo.aggregate?.failedSources.length" @toggle-page="togglePage" @retry="handleRetry"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch } from '@common/utils/vueTools'
import { searchText } from '@renderer/store/search/state'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import useList, { type SearchSource } from './useList'
import SongList from '@renderer/views/songList/List/components/SongList.vue'
import AggregateStatus from '../components/AggregateStatus.vue'
import { retryFailedSources } from '@renderer/store/search/songlist'

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
} = useList()

watch(() => [searchText.value, props.sourceId, props.page] as const, ([text, sourceId, page]) => {
  if (!text) return
  search(text, sourceId, page || 1)
}, {
  immediate: true,
})

const togglePage = (page: number) => {
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      page,
    },
  })
  // search(searchText.value, props.sourceId, page)
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
  padding-top: 5px;
}

.results { flex: 1; min-height: 0; position: relative; }

// .list {
//   overflow: hidden;
//   height: 100%;
//   flex: auto;
// }

</style>
