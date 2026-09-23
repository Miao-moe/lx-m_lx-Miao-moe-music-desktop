<template>
  <section :class="$style.page" data-listening-history>
    <header :class="$style.header">
      <h2>{{ $t('history__title') }}</h2>
      <p>{{ $t('history__stats', { plays: result.stats.plays, songs: result.stats.songs, artists: result.stats.singers }) }}</p>
    </header>
    <form :class="$style.filters" @submit.prevent="applyFilters">
      <label>{{ $t('history__from') }} <base-input v-model="fromDate" type="date" :disabled="loading" /></label>
      <label>{{ $t('history__to') }} <base-input v-model="toDate" type="date" :disabled="loading" /></label>
      <label :class="$style.searchLabel">{{ $t('history__search') }} <base-input v-model="search" :placeholder="$t('history__search_placeholder')" :disabled="loading" :trim="false" /></label>
      <base-btn type="submit" :disabled="loading">{{ $t('history__query') }}</base-btn>
      <base-btn :disabled="loading" @click="clearHistory">{{ $t('history__clear') }}</base-btn>
    </form>
    <p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
    <p v-else-if="loading" :class="$style.status" role="status">{{ $t('history__loading') }}</p>
    <p v-else-if="!result.rows.length" :class="$style.status" role="status">{{ $t('history__empty') }}</p>
    <ul v-else :class="[$style.rows, 'scroll']">
      <li v-for="entry in result.rows" :key="entry.id" :class="$style.row">
        <span :class="$style.song">
          <strong>{{ entry.song.name }}</strong>
          <small>{{ entry.song.singer }} · {{ entry.song.source }}</small>
        </span>
        <time :datetime="new Date(entry.time).toISOString()">{{ date(entry.time) }}</time>
        <base-btn min :aria-label="$t('history__play_song', { name: entry.song.name })" @click="play(entry.song)">{{ $t('history__play') }}</base-btn>
      </li>
    </ul>
    <footer :class="$style.footer">
      <base-btn :disabled="loading || page === 0" @click="changePage(-1)">{{ $t('history__previous') }}</base-btn>
      <span>{{ page + 1 }}</span>
      <base-btn :disabled="loading || (page + 1) * 50 >= result.stats.plays" @click="changePage(1)">{{ $t('history__next') }}</base-btn>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
import { libraryCall, listeningHistoryVersion } from '@renderer/utils/library'
import { addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playQueueById } from '@renderer/core/player'
import { dialog } from '@renderer/plugins/Dialog'
import { useI18n } from '@renderer/plugins/i18n'

const t = useI18n()
const fromDate = ref('')
const toDate = ref('')
const search = ref('')
const page = ref(0)
const loading = ref(false)
const error = ref('')
const result = ref<Awaited<ReturnType<typeof libraryCall<'getListeningHistory'>>>>({
  rows: [], stats: { plays: 0, songs: 0, singers: 0 }, artists: [],
})
let generation = 0

const date = (time: number) => new Date(time).toLocaleString(window.i18n.locale)
const load = async() => {
  const current = ++generation
  const from = fromDate.value ? new Date(fromDate.value + 'T00:00:00').getTime() : undefined
  const to = toDate.value ? new Date(toDate.value + 'T23:59:59.999').getTime() : undefined
  if (from && to && from > to) {
    loading.value = false
    error.value = t('history__invalid_date')
    return
  }
  loading.value = true
  error.value = ''
  try {
    const next = await libraryCall('getListeningHistory', { from, to, search: search.value, page: page.value })
    if (current === generation) result.value = next
  } catch (cause) {
    if (current === generation) error.value = formatError(cause, t('history__load_failed'), 'HISTORY_LOAD_FAILED')
  } finally {
    if (current === generation) loading.value = false
  }
}
const applyFilters = () => { page.value = 0; void load() }
const changePage = (direction: number) => { page.value += direction; void load() }
const clearHistory = async() => {
  if (!await dialog.confirm({ message: t('history__clear_confirm'), confirmButtonText: t('history__clear') })) return
  try {
    await libraryCall('clearListeningHistory')
    page.value = 0
    listeningHistoryVersion.value++
  } catch (cause) {
    error.value = formatError(cause, t('history__clear_failed'), 'HISTORY_CLEAR_FAILED')
  }
}
const play = (song: LX.Music.MusicInfo) => {
  const wasPlaying = !!playMusicInfo.musicInfo
  const index = addTempPlayList([{ listId: null, musicInfo: song }])
  if (wasPlaying) playQueueById(index)
}
watch(listeningHistoryVersion, () => { void load() })
onMounted(() => { void load() })
onBeforeUnmount(() => { generation++ })
</script>

<style lang="less" module>
.page { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; padding: 20px; box-sizing: border-box; color: var(--color-font); }
.header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.header h2 { font-size: 20px; }
.header p { color: var(--color-font-label); font-size: 12px; }
.filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; padding-bottom: 14px; border-bottom: var(--color-list-header-border-bottom); }
.filters label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--color-font-label); }
.searchLabel { flex: 1; min-width: 150px; }
.searchLabel input { width: 100%; box-sizing: border-box; }
.status { margin: 20px 0; color: var(--color-font-label); }
.error { margin: 12px 0; color: var(--color-danger); white-space: pre-wrap; }
.rows { flex: 1; min-height: 0; margin: 0; padding: 0; list-style: none; overflow-y: auto; }
.row { display: flex; align-items: center; gap: 16px; min-height: 56px; padding: 8px 2px; border-bottom: 1px solid var(--color-200); }
.song { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 3px; }
.song strong, .song small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.song small, .row time { color: var(--color-font-label); font-size: 12px; }
.row time { flex: none; }
.footer { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 12px; }
@media (max-width: 680px) { .row { flex-wrap: wrap; gap: 6px; } .row time { order: 3; width: 100%; } }
</style>
