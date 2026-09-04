<template>
  <div :class="$style.container">
    <SongList
      ref="listRef" :list-info="listInfo" :visible-source="sourceId == 'all'" search-on-click
      :search-result-type="type" @toggle-page="togglePage" @retry="handleRetry"
    />
  </div>
</template>

<script setup lang="ts">
import { watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { searchText } from '@renderer/store/search/state'
import type { EntityType, SearchSource } from '@renderer/store/search/entity'
import SongList from '@renderer/views/songList/List/components/SongList.vue'
import useList from './useList'

const props = defineProps<{
  type: EntityType
  sourceId: SearchSource
  page: number
}>()
const route = useRoute()
const router = useRouter()
const { listRef, listInfo, search } = useList()

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
  search(props.type, searchText.value, props.sourceId, props.page || 1)
}
</script>

<style lang="less" module>
.container {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  padding-top: 5px;
}
</style>
