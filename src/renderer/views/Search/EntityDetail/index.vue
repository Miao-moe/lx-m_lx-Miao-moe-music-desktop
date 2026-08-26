<template>
  <div :class="$style.container">
    <header :class="$style.header">
      <div :class="[$style.cover, { [$style.singerCover]: type == 'singer' }]">
        <img v-if="coverUrl && !coverError" :src="coverUrl" :alt="entityDetailInfo.info.name" @error="coverError = true">
        <svg v-else version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24" space="preserve">
          <use xlink:href="#icon-music" />
        </svg>
      </div>
      <div :class="$style.headerContent">
        <p :class="$style.eyebrow">{{ entityLabel }} · {{ sourceLabel }}</p>
        <h3 :title="entityDetailInfo.info.name">{{ entityDetailInfo.info.name }}</h3>
        <p v-if="entityDetailInfo.info.author" :class="$style.author" :title="entityDetailInfo.info.author">{{ entityDetailInfo.info.author }}</p>
        <p v-if="entityDetailInfo.info.desc" :class="$style.description" :title="entityDetailInfo.info.desc">{{ entityDetailInfo.info.desc }}</p>
      </div>
      <div :class="$style.actions">
        <base-btn :class="$style.action" :disabled="!entityDetailInfo.list.length" @click="handlePlayAll">{{ $t('list__play') }}</base-btn>
        <base-btn :class="$style.action" :disabled="!entityDetailInfo.list.length" @click="handleCollect">{{ $t('list__collect') }}</base-btn>
        <base-btn :class="$style.action" @click="handleBack">{{ $t('back') }}</base-btn>
      </div>
    </header>
    <div :class="$style.list">
      <material-online-list
        ref="listRef"
        :page="entityDetailInfo.page"
        :limit="entityDetailInfo.limit"
        :total="entityDetailInfo.total"
        :list="entityDetailInfo.list"
        :no-item="entityDetailInfo.noItemLabel"
        @play-list="handlePlayList"
        @toggle-page="togglePage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from '@common/utils/vueTools'
import { useRoute, useRouter } from '@common/utils/vueRouter'
import { sourceNames } from '@renderer/store'
import { getAndSetEntityDetail } from '@renderer/store/entityDetail/action'
import { entityDetailInfo } from '@renderer/store/entityDetail/state'
import type { EntitySummary } from '@renderer/store/entityDetail/state'
import { sources as entitySources } from '@renderer/store/search/entity'
import type { EntityType, SearchSource } from '@renderer/store/search/entity'
import useKeyBack from '@renderer/views/songList/Detail/useKeyBack'
import { addEntityDetail, playEntityDetail } from './action'

const route = useRoute()
const router = useRouter()
const listRef = ref<any>(null)
const coverError = ref(false)

const getQueryString = (value: unknown) => Array.isArray(value) ? String(value[0] ?? '') : typeof value == 'string' ? value : ''
const routeType = computed(() => getQueryString(route.query.type))
const type = computed<EntityType>(() => routeType.value == 'album' ? 'album' : 'singer')
const source = computed<SearchSource>(() => getQueryString(route.query.source) as SearchSource)
const id = computed(() => getQueryString(route.query.id))
const page = computed(() => {
  const value = Number(getQueryString(route.query.page))
  return Number.isSafeInteger(value) && value > 0 ? value : 1
})
const summary = computed<EntitySummary>(() => ({
  name: getQueryString(route.query.name),
  author: getQueryString(route.query.author),
  img: getQueryString(route.query.picUrl),
  desc: getQueryString(route.query.desc),
  total: Math.max(0, Number(getQueryString(route.query.total)) || 0),
}))
const entityLabel = computed(() => window.i18n.t(type.value == 'singer' ? 'search__type_singer' : 'search__type_album'))
const sourceLabel = computed(() => sourceNames.value[source.value] ?? source.value)
const coverUrl = computed(() => entityDetailInfo.info.img ?? summary.value.img)

const getFallbackRoute = () => ({
  path: '/search',
  query: {
    source: source.value != 'all' && entitySources.includes(source.value) ? source.value : 'all',
    type: type.value,
    page: 1,
    text: summary.value.name || undefined,
  },
})

const handleBack = () => {
  const from = getQueryString(route.query.from)
  if (from.startsWith('/search') && !from.startsWith('/search/entity/detail')) void router.replace(from)
  else void router.replace(getFallbackRoute())
}

const togglePage = (targetPage: number) => {
  void router.replace({
    path: route.path,
    query: {
      ...route.query,
      page: targetPage,
    },
  })
}

const handlePlayAll = () => {
  if (source.value == 'all') return
  void playEntityDetail(type.value, id.value, source.value, summary.value, entityDetailInfo.list)
}
const handleCollect = () => {
  if (source.value == 'all') return
  void addEntityDetail(type.value, id.value, source.value, summary.value, entityDetailInfo.list)
}
const handlePlayList = (index: number) => {
  if (source.value == 'all') return
  void playEntityDetail(type.value, id.value, source.value, summary.value, entityDetailInfo.list, index)
}

watch(coverUrl, () => {
  coverError.value = false
})
watch([routeType, type, source, id, page, summary], async([currentRouteType, currentType, currentSource, currentId, currentPage, currentSummary]) => {
  if ((currentRouteType != 'singer' && currentRouteType != 'album') || !currentId || !currentSummary.name || currentSource == 'all' || !entitySources.includes(currentSource)) {
    await router.replace(getFallbackRoute())
    return
  }
  await getAndSetEntityDetail(currentType, currentId, currentSource, currentPage, currentSummary).catch(() => {})
  await nextTick()
  listRef.value?.scrollToTop()
}, { immediate: true })

useKeyBack(handleBack)
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.container {
  display: flex;
  flex-flow: column nowrap;
  min-width: 0;
}

.header {
  flex: none;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 96px;
  padding: 0 15px;
  gap: 12px;
}

.cover {
  flex: none;
  width: 80px;
  height: 80px;
  display: flex;
  overflow: hidden;
  border-radius: var(--radius-md);
  background-color: var(--color-active);
  box-shadow: 0 0 2px 0 rgba(0, 0, 0, .2);
  opacity: .9;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: entity-cover-in var(--duration-normal) var(--ease-standard) both;
  }

  svg {
    width: 34%;
    margin: auto;
    fill: var(--color-text-muted);
    opacity: .45;
  }
}

.singerCover {
  border-radius: 50%;
}

.headerContent {
  flex: auto;
  min-width: 0;
  align-self: stretch;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;

  h3 {
    .mixin-ellipsis-1();
    line-height: 1.25;
    color: var(--color-font);
  }
}

.eyebrow {
  margin-bottom: 3px;
  font-size: 11px;
  line-height: 1.2;
  color: var(--color-font-label);
}

.author,
.description {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.2;
  color: var(--color-font-label);
}

.author {
  .mixin-ellipsis-1();
}

.description {
  .mixin-ellipsis(2);
}

.actions {
  flex: none;
  display: flex;
  align-items: center;

  .action {
    border-radius: 0;

    &:first-child {
      border-top-left-radius: var(--radius-sm);
      border-bottom-left-radius: var(--radius-sm);
    }

    &:last-child {
      border-top-right-radius: var(--radius-sm);
      border-bottom-right-radius: var(--radius-sm);
    }
  }
}

.list {
  position: relative;
  width: 100%;
  min-height: 0;
  flex: auto;
}

@keyframes entity-cover-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (max-width: 760px) {
  .header {
    height: 84px;
    padding: 0 10px;
    gap: 8px;
  }

  .cover {
    width: 68px;
    height: 68px;
  }

  .description {
    display: none;
  }
}
</style>
