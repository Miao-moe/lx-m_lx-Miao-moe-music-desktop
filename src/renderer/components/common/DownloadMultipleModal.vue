<template>
  <material-modal :show="show" :bg-close="bgClose && !starting" :teleport="teleport" @close="handleClose">
    <main :class="$style.main">
      <h2>{{ $t('download__multiple_tip', { len: list.length }) }}<br>{{ $t('download__multiple_tip2') }}</h2>
      <div :class="$style.qualities">
        <base-btn
          v-for="option in qualityOptions" :key="option.quality" :class="[$style.btn, { [$style.selected]: selectedQuality === option.quality }]"
          :aria-pressed="selectedQuality === option.quality" :disabled="starting" @click="selectedQuality = option.quality"
        >{{ $t(option.label) }} - {{ option.display }}</base-btn>
      </div>
      <section :class="$style.space" aria-live="polite">
        <p v-if="loading">{{ $t('download__space_preparing') }}</p>
        <template v-else-if="ready">
          <p v-if="!preview.count" role="alert">{{ $t('download__space_no_new_tasks') }}</p>
          <template v-else>
            <p>{{ $t('download__space_estimate', {
              size: sizeFormate(preview.summary.knownBytes),
              known: preview.summary.knownCount,
              approx: preview.summary.approximateCount,
              unknown: preview.summary.unknownCount,
            }) }}</p>
            <p v-if="preview.availableBytes != null">{{ $t('download__space_free', { size: sizeFormate(preview.availableBytes ?? 0) }) }}</p>
            <p v-else>{{ $t('download__space_free_unknown') }}</p>
            <p v-if="preview.availableBytes != null && !preview.summary.insufficientDisk">
              {{ $t('download__space_remaining', { size: sizeFormate(Math.max(0, (preview.availableBytes ?? 0) - preview.summary.knownBytes)) }) }}
            </p>
            <p v-if="preview.summary.unknownCount" :class="$style.warning">{{ $t('download__space_unknown_warning') }}</p>
            <p v-if="preview.summary.overTaskCount" :class="$style.error" role="alert">{{ $t('download__space_task_exceeded', { count: preview.summary.overTaskCount }) }}</p>
            <p v-if="preview.summary.overBatch" :class="$style.error" role="alert">{{ $t('download__space_batch_exceeded') }}</p>
            <p v-if="preview.summary.insufficientDisk" :class="$style.error" role="alert">{{ $t('download__space_disk_shortage') }}</p>
          </template>
        </template>
        <p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
      </section>
      <div :class="$style.actions">
        <base-btn min :disabled="loading || starting" @click="refresh">{{ $t('download__space_refresh') }}</base-btn>
        <base-btn :disabled="!canStart" @click="start">{{ $t('download__space_start') }}</base-btn>
      </div>
    </main>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from '@common/utils/vueTools'
import { sizeFormate } from '@common/utils'
import { formatError } from '@common/utils/errorMessage'
import { useI18n } from '@renderer/plugins/i18n'
import { createDownloadTasks, previewDownloadTasks, type DownloadStoragePreview } from '@renderer/store/download/action'

const props = withDefaults(defineProps<{
  show: boolean
  bgClose?: boolean
  listId?: string
  list: LX.Music.MusicInfo[]
  teleport?: string
}>(), { bgClose: true, listId: '', teleport: '#root' })
const emit = defineEmits<{ 'update:show': [show: boolean], confirm: [] }>()
const t = useI18n()
const qualityOptions: Array<{ quality: LX.Quality, label: string, display: string }> = [
  { quality: '128k', label: 'download__normal', display: '128K' },
  { quality: '320k', label: 'download__high_quality', display: '320K' },
  { quality: 'flac', label: 'download__lossless', display: 'FLAC' },
  { quality: 'flac24bit', label: 'download__lossless', display: 'FLAC 24Bit' },
  { quality: 'hires', label: 'download__lossless', display: 'HIRES' },
  { quality: 'atmos', label: 'download__lossless', display: 'ATMOS' },
  { quality: 'master', label: 'download__lossless', display: 'MASTER' },
]
const selectedQuality = ref<LX.Quality>('128k')
const preview = ref<DownloadStoragePreview>({
  count: 0,
  availableBytes: null,
  summary: { knownBytes: 0, knownCount: 0, approximateCount: 0, unknownCount: 0, overTaskCount: 0, overBatch: false, insufficientDisk: false },
})
const ready = ref(false)
const loading = ref(false)
const starting = ref(false)
const error = ref('')
const onlineList = computed(() => props.list.filter((item: LX.Music.MusicInfo): item is LX.Music.MusicInfoOnline => item.source !== 'local'))
const canStart = computed(() => ready.value && !loading.value && !starting.value && !error.value && !!preview.value.count &&
  !preview.value.summary.overTaskCount && !preview.value.summary.overBatch && !preview.value.summary.insufficientDisk)
let generation = 0
const refresh = async() => {
  const current = ++generation
  ready.value = false
  error.value = ''
  if (!props.show) return
  loading.value = true
  try {
    const result = await previewDownloadTasks(onlineList.value, selectedQuality.value, props.listId, true)
    if (current === generation) { preview.value = result; ready.value = true }
  } catch (cause) {
    if (current === generation) error.value = formatError(cause, t('download__space_failed'), 'DOWNLOAD_SPACE_FAILED')
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(() => [props.show, props.list, props.listId, selectedQuality.value], () => { void refresh() }, { immediate: true })
const handleClose = () => { if (!starting.value) emit('update:show', false) }
const start = async() => {
  if (!canStart.value) return
  starting.value = true
  try {
    if (await createDownloadTasks(onlineList.value, selectedQuality.value, props.listId, true)) {
      emit('update:show', false)
      emit('confirm')
    } else await refresh()
  } finally { starting.value = false }
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  width: min(440px, 80vw);
  max-height: 70vh;
  overflow-y: auto;
  color: var(--color-font);
  h2 {
    font-size: 13px;
    line-height: 1.3;
    text-align: center;
    margin-bottom: 15px;
  }
}
.qualities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  > :last-child:nth-child(odd) { grid-column: 1 / -1; }
}
.btn { display: block; width: 100%; }
.selected { box-shadow: inset 3px 0 var(--color-primary); }
.space { margin: 15px 0; line-height: 1.5; font-size: 12px; }
.space p { margin: 4px 0; }
.warning { color: var(--color-font-label); }
.error { color: var(--color-danger); white-space: pre-wrap; }
.actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
</style>
