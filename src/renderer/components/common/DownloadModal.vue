<template>
  <material-modal :show="show" :bg-close="bgClose && !starting" :teleport="teleport" @close="handleClose">
    <main :class="$style.main">
      <h2>{{ info.name }}<br>{{ info.singer }}</h2>
      <p v-if="refreshingQuality" :class="$style.hint" role="status">{{ $t('loading') }}</p>
      <base-btn v-for="quality in qualitys" :key="quality.type" :class="$style.btn" :disabled="starting || refreshingQuality" @click="handleClick(quality.type)">
        {{ getTypeName(quality.type) }}{{ getQualitySizeLabel(quality) }}
      </base-btn>
      <p v-if="qualityLookupFailed" :class="$style.hint" role="status">{{ $t('download__quality_lookup_failed') }}</p>
      <base-btn v-if="qualityLookupFailed" min :class="$style.btn" @click="refreshQuality(true)">{{ $t('reload') }}</base-btn>
    </main>
  </material-modal>
</template>

<script>
import { qualityList } from '@renderer/store'
import { createDownloadTasks } from '@renderer/store/download/action'
import { toNewMusicInfo, toOldMusicInfo } from '@renderer/utils'
import musicSdk from '@renderer/utils/musicSdk'
import { getMusicUrl as getStoredMusicUrl } from '@renderer/utils/ipc'
import { getAudioFileSize } from '@renderer/utils/request'
import { awaitRequest, getRequestSignal, withRequestDeadline } from '@renderer/utils/requestContext'
import { sizeFormate } from '@common/utils/common'
import { getDownloadQualityOptions, isExtraDownloadQuality, mergeMatchedSearchQuality, shouldRefreshDownloadQuality } from './downloadQuality'

export default {
  props: {
    show: {
      type: Boolean,
      default: false,
    },
    musicInfo: {
      type: [Object, null],
      required: true,
    },
    listId: {
      type: String,
      default: '',
    },
    resolveQualityFromSearch: {
      type: Boolean,
      default: false,
    },
    bgClose: {
      type: Boolean,
      default: true,
    },
    teleport: {
      type: String,
      default: '#root',
    },
  },
  emits: ['update:show'],
  setup() {
    return {
      qualityList,
    }
  },
  data() {
    return {
      starting: false,
      refreshingQuality: false,
      qualityLookupFailed: false,
      resolvedMusicInfo: null,
      qualityLookupController: null,
      qualitySizes: {},
      qualitySizeLoading: {},
    }
  },
  computed: {
    info() {
      return this.resolvedMusicInfo || this.musicInfo || {}
    },
    sourceQualityList() {
      return this.qualityList[this.info.source] || []
    },
    qualitys() {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      return getDownloadQualityOptions(this.info, this.sourceQualityList).map(quality => ({
        ...quality,
        size: quality.size || this.qualitySizes[quality.type] || null,
      }))
    },
  },
  watch: {
    show: {
      immediate: true,
      handler(show) {
        if (show) void this.refreshQuality()
        else this.cancelQualityLookup()
      },
    },
    musicInfo() {
      if (this.show) void this.refreshQuality()
    },
    sourceQualityList() {
      if (this.show) void this.refreshQuality()
    },
  },
  beforeUnmount() {
    this.cancelQualityLookup()
  },
  methods: {
    cancelQualityLookup() {
      this.qualityLookupController?.abort()
      this.qualityLookupController = null
      this.refreshingQuality = false
    },
    async refreshQuality(forceRefresh = false) {
      this.cancelQualityLookup()
      this.resolvedMusicInfo = null
      this.qualityLookupFailed = false
      this.qualitySizes = {}
      this.qualitySizeLoading = {}
      const musicInfo = this.musicInfo
      if (!this.show || !musicInfo) return
      const controller = new AbortController()
      this.qualityLookupController = controller
      if (shouldRefreshDownloadQuality(musicInfo, this.sourceQualityList, this.listId || this.resolveQualityFromSearch)) {
        const searchSource = musicSdk[musicInfo.source]?.musicSearch
        const search = searchSource?.search
        if (typeof search == 'function') {
          this.refreshingQuality = true
          try {
            const query = `${musicInfo.name} ${musicInfo.singer || ''}`.trim()
            const matchedInfo = await withRequestDeadline(8000, async() => {
              const result = await search.call(searchSource, query, 1, 30, { refresh: forceRefresh })
              let info = mergeMatchedSearchQuality(musicInfo, result.list.map(toNewMusicInfo))
              if (info === musicInfo && musicInfo.singer) {
                const byName = await search.call(searchSource, musicInfo.name, 1, 50, { refresh: forceRefresh })
                info = mergeMatchedSearchQuality(musicInfo, byName.list.map(toNewMusicInfo))
              }
              return info
            }, controller.signal)
            if (this.qualityLookupController !== controller || !this.show) return
            this.resolvedMusicInfo = matchedInfo
            if (matchedInfo === musicInfo) this.qualityLookupFailed = true
          } catch {
            if (this.qualityLookupController === controller && !controller.signal.aborted) this.qualityLookupFailed = true
          } finally {
            if (this.qualityLookupController === controller) this.refreshingQuality = false
          }
        }
      }
      if (this.qualityLookupController === controller && this.show) void this.refreshExtendedSizes(controller)
    },
    async refreshExtendedSizes(controller) {
      const musicInfo = this.info
      const missing = getDownloadQualityOptions(musicInfo, this.sourceQualityList)
        .filter(quality => isExtraDownloadQuality(quality.type) && !quality.size)
      this.qualitySizeLoading = Object.fromEntries(missing.map(({ type }) => [type, true]))
      await Promise.all(missing.map(async({ type }) => {
        let bytes = null
        try {
          bytes = await withRequestDeadline(10000, async() => {
            const signal = getRequestSignal()
            const cachedUrl = await awaitRequest(getStoredMusicUrl(musicInfo, type)).catch(() => null)
            if (signal.aborted) return null
            if (cachedUrl) {
              const cachedSize = await getAudioFileSize(cachedUrl, signal).catch(() => null)
              if (cachedSize) return cachedSize
            }
            const result = await awaitRequest(musicSdk[musicInfo.source].getMusicUrl(toOldMusicInfo(musicInfo), type))
            if (result?.type !== type || !result.url) return null
            return getAudioFileSize(result.url, signal)
          }, controller.signal)
        } catch {}
        if (this.qualityLookupController !== controller || !this.show) return
        if (bytes) this.qualitySizes = { ...this.qualitySizes, [type]: sizeFormate(bytes) }
        this.qualitySizeLoading = { ...this.qualitySizeLoading, [type]: false }
      }))
    },
    getQualitySizeLabel(quality) {
      if (quality.size) return ` - ${String(quality.size).toUpperCase()}`
      if (!isExtraDownloadQuality(quality.type)) return ''
      return ` - ${this.$t(this.qualitySizeLoading[quality.type] ? 'loading' : 'download__size_unknown')}`
    },
    async handleClick(quality) {
      if (this.starting || this.refreshingQuality) return
      this.starting = true
      try {
        const musicInfo = JSON.parse(JSON.stringify(this.info))
        if (await createDownloadTasks([musicInfo], quality, this.listId)) this.$emit('update:show', false)
      } finally { this.starting = false }
    },
    handleClose() {
      if (!this.starting) this.$emit('update:show', false)
    },
    getTypeName(quality) {
      switch (quality) {
        case 'flac24bit':
          return this.$t('download__lossless') + ' FLAC 24Bit'
        case 'atmos_plus':
          return this.$t('download__lossless') + ' ATMOS PLUS'
        case 'hires':
        case 'atmos':
        case 'master':
        case 'flac':
        case 'ape':
        case 'wav':
          return this.$t('download__lossless') + ' ' + quality.toUpperCase()
        case '320k':
          return this.$t('download__high_quality') + ' ' + quality.toUpperCase()
        case '192k':
        case '128k':
          return this.$t('download__normal') + ' ' + quality.toUpperCase()
      }
    },
  },
}
</script>


<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  padding: 15px;
  max-width: 400px;
  min-width: 200px;
  max-height: 70vh;
  overflow-y: auto;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  h2 {
    font-size: 13px;
    color: var(--color-font);
    line-height: 1.3;
    text-align: center;
    margin-bottom: 15px;
  }
}

.btn {
  display: block;
  margin-bottom: 15px;
  &:last-child {
    margin-bottom: 0;
  }
}
.hint {
  margin-bottom: 8px;
  color: var(--color-font-label);
  font-size: 12px;
  text-align: center;
}

</style>
