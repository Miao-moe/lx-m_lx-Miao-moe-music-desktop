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
    const findSample = (list, quality) => {
      return list.find(info => info._types?.[quality] || info.types?.some(item => item.type == quality)) ?? list[0]
    }
    const checkQuality = async(source, quality, list, currentRunId) => {
      const getMusicUrl = userApi.apis[source]?.getMusicUrl
      const musicInfo = findSample(list, quality)
      if (typeof getMusicUrl != 'function' || !musicInfo) {
        updateResult(source, quality, 'unsupported', currentRunId)
        return
      }

      let cancel
      try {
        // Search results already use the legacy song shape expected by custom-source scripts.
        const request = getMusicUrl(musicInfo, quality)
        cancel = request?.canceleFn
        if (typeof cancel == 'function') cancelFns.add(cancel)
        const response = await (request?.promise ?? request)
        const url = typeof response == 'string' ? response : response?.url
        updateResult(source, quality, typeof url == 'string' && /^https?:\/\//.test(url) ? 'supported' : 'unsupported', currentRunId)
      } catch (_) {
        updateResult(source, quality, 'unsupported', currentRunId)
      } finally {
        if (cancel) cancelFns.delete(cancel)
      }
    }
    const checkSource = async(source, currentRunId) => {
      const sourceQualities = qualities.filter(quality => results[source][quality] == 'pending')
      if (!sourceQualities.length) return

      let list = []
      try {
        const search = musicSdk[source]?.musicSearch
        const response = await search.search('爱', 1, 10)
        list = Array.isArray(response?.list) ? response.list : []
      } catch (_) {}
      if (currentRunId != runId) return
      if (!list.length) {
        for (const quality of sourceQualities) updateResult(source, quality, 'unsupported', currentRunId)
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
      const tasks = []
      for (const source of sources) tasks.push(checkSource(source, currentRunId))
      await Promise.all(tasks)
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
