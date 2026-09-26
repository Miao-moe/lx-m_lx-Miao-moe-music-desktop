<template>
  <dd data-setting-search="setting__sync_status">
    <div class="setting-actions"><base-btn id="sync_status" class="btn gap-left" min @click="showModal = true">{{ $t('setting__sync_status_open') }}</base-btn></div>
    <material-modal :show="showModal" bg-close teleport="#view" width="760px" max-width="90%" max-height="80%" @close="showModal = false">
      <main :class="$style.panel" role="dialog" aria-modal="true" aria-labelledby="sync_status_title">
        <h2 id="sync_status_title">{{ $t('setting__sync_status') }}</h2>
        <div :class="$style.tools"><base-input v-model="query" :placeholder="$t('setting__sync_status_search')" :auto-paste="false" /><base-checkbox id="sync_errors_only" v-model="errorsOnly" :label="$t('setting__sync_status_errors_only')" /></div>
        <p v-if="!rows.length" class="p small">{{ $t('setting__sync_status_empty') }}</p>
        <ul v-else class="scroll" :class="$style.list">
          <li v-for="[key, item] in rows" :key="key">
            <div :class="$style.title"><strong>{{ item.label }}</strong><span>{{ $t(`setting__sync_status_${item.state}`) }}{{ item.total !== undefined ? ` · ${item.completed ?? 0}/${item.total}` : '' }}</span><base-btn v-if="item.state === 'failed' && !key.startsWith('device:')" min :disabled="retrying[key]" @click="retry(key)">{{ $t('setting__sync_status_retry') }}</base-btn></div>
            <p>{{ $t('setting__sync_status_last_run', { time: time(item.time) }) }} · {{ $t('setting__sync_status_last_success', { time: item.lastSuccess ? time(item.lastSuccess) : $t('setting__sync_status_never') }) }}</p>
            <p v-if="item.error" class="load-error-detail" role="status">{{ item.error }}</p>
          </li>
        </ul>
      </main>
    </material-modal>
  </dd>
</template>
<script setup lang="ts">
import { ref, reactive, computed } from '@common/utils/vueTools'
import { useI18n } from '@renderer/plugins/i18n'
import { syncStatuses, finishSync } from '@renderer/store/syncStatus'
import { runWebDAVAction } from '@renderer/store/webdav'
import { userLists } from '@renderer/store/list/state'
import syncSourceList from '@renderer/store/list/syncSourceList'
import { retryPlaylistWriteback } from '@renderer/utils/playlistWriteback'
import { syncCookiePlaylists } from '@renderer/utils/cookieSync'
import { type CookieSource } from '@renderer/utils/cookieManager'
import { updatePlatformLists } from '@renderer/core/useApp/listAutoUpdate'
const t = useI18n()
const showModal = ref(false)
const query = ref(''); const errorsOnly = ref(false)
const retrying = reactive<Record<string, boolean>>({})
const rows = computed(() => Object.entries(syncStatuses).filter(([, value]) => (!errorsOnly.value || value.state === 'failed') && value.label.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).sort((a, b) => b[1].time - a[1].time))
const time = (value: number) => new Date(value).toLocaleString()
const retry = async(key: string) => {
  retrying[key] = true
  try {
    if (key === 'webdav') await runWebDAVAction('sync')
    else if (key === 'webdav:test') await runWebDAVAction('test')
    else if (key === 'platform-auto') await updatePlatformLists()
    else if (key.startsWith('playlist:')) {
      const list = userLists.find(list => list.id === key.slice(9))
      if (!list) throw new Error(t('setting__sync_status_missing_list'))
      await syncSourceList(list)
    } else if (key.startsWith('writeback:')) await retryPlaylistWriteback(key.slice(10))
    else if (key.startsWith('cookie:')) await syncCookiePlaylists(key.split(':')[1] as CookieSource)
  } catch (error) { finishSync(key, error) } finally { retrying[key] = false }
}
</script>
<style lang="less" module>
.panel { width: 100%; min-height: 0; padding: 20px 24px 24px; display: flex; flex-direction: column; overflow: hidden; }
.panel h2 { margin-bottom: 16px; font-size: 18px; }
.tools, .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.tools { flex: none; margin-bottom: 12px; }
.list { min-height: 0; max-height: 400px; overflow: auto; li { padding: 12px 2px; border-bottom: 1px solid var(--color-primary-background-hover); } p { font-size: 12px; line-height: 1.7; margin-top: 6px; overflow-wrap: anywhere; } }
</style>
