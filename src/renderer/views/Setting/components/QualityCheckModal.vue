<template lang="pug">
material-modal(
  :show="modelValue"
  max-height="80%"
  max-width="90%"
  teleport="#view"
  width="760px"
  @close="handleClose"
)
  main(:class="$style.main")
    h2 {{ $t('setting__basic_source_check_quality') }}
    p(:class="$style.tip") {{ $t('setting__basic_source_check_quality_tip') }}
    div.scroll(v-if="hasAvailableSource" :class="$style.tableWrap")
      table(:class="$style.table")
        thead
          tr
            th(scope="col") {{ $t('music_source') }}
            th(v-for="quality in qualities" :key="quality" scope="col") {{ quality }}
        tbody
          tr(v-for="source in sources" :key="source")
            td(:class="$style.source") {{ $t('source_' + source) }}
            td(v-for="quality in qualities" :key="quality")
              span(:class="cellClass(results[source][quality])") {{ cellText(results[source][quality]) }}
    p(v-if="hasAvailableSource" :class="$style.legend") {{ $t('setting__basic_source_check_quality_legend') }}
    p(v-else :class="$style.empty") {{ $t('setting__basic_source_check_quality_empty') }}
    p(v-if="isChecking" :class="$style.running") {{ $t('setting__basic_source_check_quality_running') }}
    div(:class="$style.footer")
      base-btn(:class="$style.footerBtn" :disabled="isChecking || !hasAvailableSource" @click="startCheck") {{ $t('setting__basic_source_check_quality_again') }}
      base-btn(:class="$style.footerBtn" @click="handleClose") {{ $t('close') }}
</template>

<script>
import { computed, onBeforeUnmount, reactive, ref, useCssModule, watch } from '@common/utils/vueTools'
import { qualityList, userApi } from '@renderer/store'
import { appSetting } from '@renderer/store/setting'
import musicSdk from '@renderer/utils/musicSdk'

const sources = ['wy', 'tx', 'kg', 'kw', 'mg']
const qualities = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master']
const extendedQualities = new Set(['hires', 'atmos', 'master'])
const createResults = () => Object.fromEntries(sources.map(source => [source, Object.fromEntries(qualities.map(quality => [quality, 'unavailable']))]))

export default {
  name: 'QualityCheckModal',
  props: {
    modelValue: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const $style = useCssModule()
    const results = reactive(createResults())
    const isChecking = ref(false)
    const cancelFns = new Set()
    let runId = 0

    const isSourceAvailable = source => {
      return qualityList.value[source]?.length && typeof userApi.apis[source]?.getMusicUrl == 'function'
    }
    const hasAvailableSource = computed(() => {
      return /^user_api/.test(appSetting['common.apiSource']) && userApi.status && sources.some(isSourceAvailable)
    })
    const cancelCheck = () => {
      runId++
      for (const cancel of cancelFns) cancel()
      cancelFns.clear()
      isChecking.value = false
    }
    const resetResults = () => {
      for (const source of sources) {
        for (const quality of qualities) {
          results[source][quality] = isSourceAvailable(source) && qualityList.value[source].includes(quality)
            ? 'pending'
            : 'unavailable'
        }
      }
    }
    const updateResult = (source, quality, status, currentRunId) => {
      if (currentRunId != runId) return
      results[source][quality] = status
    }
    const hasQuality = (info, quality) => {
      const sampleQuality = extendedQualities.has(quality) ? 'flac24bit' : quality
      return !!info._types?.[sampleQuality] || info.types?.some(item => item.type == sampleQuality)
    }
    const findSamples = (list, quality) => {
      return list.filter(info => hasQuality(info, quality)).slice(0, 2)
    }
    const checkQuality = async(source, quality, list, currentRunId) => {
      const getMusicUrl = userApi.apis[source]?.getMusicUrl
      const musicInfos = findSamples(list, quality)
      if (typeof getMusicUrl != 'function' || !musicInfos.length) {
        updateResult(source, quality, 'unavailable', currentRunId)
        return
      }

      for (const musicInfo of musicInfos) {
        if (currentRunId != runId) return
        let cancel
        try {
          // Search results already use the legacy song shape expected by custom-source scripts.
          const request = getMusicUrl(musicInfo, quality)
          cancel = request?.canceleFn
          if (typeof cancel == 'function') cancelFns.add(cancel)
          const response = await (request?.promise ?? request)
          const url = typeof response == 'string' ? response : response?.url
          if (typeof url == 'string' && /^https?:\/\//.test(url)) {
            updateResult(source, quality, 'supported', currentRunId)
            return
          }
        } catch (error) {
          console.warn('[quality check] request failed:', source, quality, musicInfo.name, error)
        } finally {
          if (cancel) cancelFns.delete(cancel)
        }
      }
      updateResult(source, quality, 'unsupported', currentRunId)
    }
    const checkSource = async(source, currentRunId) => {
      const sourceQualities = qualities.filter(quality => results[source][quality] == 'pending')
      if (!sourceQualities.length) return

      let list = []
      try {
        const search = musicSdk[source]?.musicSearch
        if (typeof search?.search != 'function') throw new Error('Search is not supported')
        const response = await search.search('爱', 1, 10)
        list = Array.isArray(response?.list) ? response.list : []
      } catch (error) {
        console.warn('[quality check] sample search failed:', source, error)
      }
      if (currentRunId != runId) return
      if (!list.length) {
        for (const quality of sourceQualities) updateResult(source, quality, 'unavailable', currentRunId)
        return
      }

      const queue = [...sourceQualities]
      const workers = Array.from({ length: Math.min(2, queue.length) }, async() => {
        // Keep per-platform concurrency low to avoid flooding the custom source.
        while (queue.length) {
          if (currentRunId != runId) return
          const quality = queue.shift()
          if (!quality) return
          await checkQuality(source, quality, list, currentRunId)
        }
      })
      await Promise.all(workers)
    }
    const startCheck = async() => {
      cancelCheck()
      resetResults()
      const currentRunId = runId
      if (!hasAvailableSource.value) return

      isChecking.value = true
      // 所有平台共用同一个自定义源，按平台串行检测，避免并发请求触发限流导致整表误判失败
      for (const source of sources) {
        if (currentRunId != runId) return
        await checkSource(source, currentRunId)
      }
      if (currentRunId == runId) isChecking.value = false
    }
    const handleClose = () => {
      cancelCheck()
      emit('update:modelValue', false)
    }
    const cellText = status => ({
      pending: '…',
      supported: '✓',
      unsupported: '✗',
      unavailable: '—',
    })[status]
    const cellClass = status => [$style.cellStatus, $style[status]]

    watch(() => props.modelValue, visible => {
      if (visible) void startCheck()
      else cancelCheck()
    })
    watch(() => [appSetting['common.apiSource'], userApi.status, qualityList.value], () => {
      if (props.modelValue) void startCheck()
    })
    onBeforeUnmount(cancelCheck)

    return {
      sources,
      qualities,
      results,
      isChecking,
      hasAvailableSource,
      startCheck,
      handleClose,
      cellText,
      cellClass,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  box-sizing: border-box;
  display: flex;
  flex: auto;
  flex-flow: column nowrap;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 15px;

  h2 {
    color: var(--color-font);
    font-size: 16px;
    line-height: 1.3;
    text-align: center;
  }
}

.tip {
  color: var(--color-550);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 8px;
  text-align: center;
}

.tableWrap {
  margin-top: 15px;
  min-height: 0;
  overflow: auto;
}

.table {
  border-collapse: collapse;
  min-width: 680px;
  table-layout: fixed;
  width: 100%;

  th,
  td {
    border: 1Px solid var(--color-primary-light-100-alpha-700);
    padding: 9px 7px;
    text-align: center;
    white-space: nowrap;
  }

  th {
    background-color: var(--color-primary-background);
    font-weight: 600;
  }

  th:first-child,
  td:first-child {
    width: 100px;
  }
}

.source {
  font-weight: 600;
}

.cellStatus {
  display: inline-block;
  min-width: 1em;
}

.pending {
  color: var(--color-500);
  opacity: .65;
}

.supported {
  color: var(--color-primary-font-active);
  font-weight: 700;
}

.unsupported,
.unavailable {
  color: var(--color-500);
}

.empty {
  color: var(--color-550);
  margin: 35px 10px 25px;
  text-align: center;
}

.legend {
  color: var(--color-550);
  font-size: 12px;
  margin-top: 10px;
  text-align: center;
  white-space: pre-wrap;
}

.running {
  color: var(--color-550);
  font-size: 12px;
  margin-top: 10px;
  text-align: center;
}

.footer {
  display: flex;
  flex: none;
  flex-flow: row nowrap;
  margin-top: 15px;
}

.footerBtn {
  flex: auto;
  height: 36px;
  line-height: 20px;
  min-width: 0;

  + .footerBtn {
    margin-left: 15px;
  }
}
</style>
