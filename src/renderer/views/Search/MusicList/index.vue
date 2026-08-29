<template>
  <div :class="$style.container">
    <material-online-list
      ref="listRef"
      :page="listInfo.page"
      :limit="listInfo.limit"
      :total="listInfo.total"
      :list="listInfo.list"
      :no-item="listInfo.noItemLabel"
      :source-tag="sourceId == 'all'"
      check-api-source
      @toggle-page="handleTogglePage"
      @play-list="handlePlayList"
      @singer-click="handleSingerClick"
      @album-click="handleAlbumClick"
    />
  </div>
</template>

<script setup lang="ts">
import { watch } from '@common/utils/vueTools'
import { searchText } from '@renderer/store/search/state'
import { useRouter, useRoute } from '@common/utils/vueRouter'
import useEntityDetailNavigation from '@renderer/utils/compositions/useEntityDetailNavigation'
import useList, { type SearchSource } from './useList'

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

const { canOpenEntity, openEntityDetail } = useEntityDetailNavigation()

watch(() => [props.sourceId, props.page], ([sourceId, page]) => {
  setTimeout(() => {
    search(searchText.value, sourceId as SearchSource, page as number || 1)
  })
})
watch(searchText, (searchText) => {
  setTimeout(() => {
    search(searchText, props.sourceId, props.page)
  })
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

const handleSingerClick = (item: LX.Music.MusicInfoOnline) => {
  if (canOpenEntity(item)) {
    openEntityDetail(item, 'singer', item.singer)
    return
  }
  void router.push({
    path: '/search',
    query: {
      source: item.source,
      type: 'singer',
      page: 1,
      text: item.singer,
    },
  })
}

const handleAlbumClick = (item: LX.Music.MusicInfoOnline) => {
  const albumName = item.meta?.albumName
  if (canOpenEntity(item) && albumName) {
    openEntityDetail(item, 'album', albumName)
    return
  }
  void router.push({
    path: '/search',
    query: {
      source: item.source,
      type: 'album',
      page: 1,
      text: albumName || item.singer,
    },
  })
}


</script>


<style lang="less" module>
.container {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
}

.list {
  overflow: hidden;
  height: 100%;
  flex: auto;
}

</style>
