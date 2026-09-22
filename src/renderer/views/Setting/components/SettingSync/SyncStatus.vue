<template>
  <dd>
    <h3 id="sync_status">同步状态</h3>
    <div :class="$style.panel">
      <div :class="$style.tools"><base-input v-model="query" placeholder="搜索平台或歌单" :auto-paste="false" /><base-checkbox id="sync_errors_only" v-model="errorsOnly" label="只看失败" /></div>
      <p v-if="!rows.length" class="p small">暂无同步记录。</p>
      <ul class="scroll" :class="$style.list">
        <li v-for="[key, item] in rows" :key="key">
          <div :class="$style.title"><strong>{{ item.label }}</strong><span>{{ labels[item.state] }}{{ item.total !== undefined ? ` · ${item.completed ?? 0}/${item.total}` : '' }}</span><base-btn v-if="item.state === 'failed' && !key.startsWith('device:')" min :disabled="retrying[key]" @click="retry(key)">重试</base-btn></div>
          <p>最近执行：{{ time(item.time) }} · 最近成功：{{ item.lastSuccess ? time(item.lastSuccess) : '尚无成功记录' }}</p>
          <p v-if="item.error" class="load-error-detail" role="status">{{ item.error }}</p>
        </li>
      </ul>
      <PlatformSyncSelection />
    </div>
  </dd>
</template>
<script setup lang="ts">
import { ref, reactive, computed } from '@common/utils/vueTools'
import { syncStatuses, finishSync } from '@renderer/store/syncStatus'
import { runWebDAVAction } from '@renderer/store/webdav'
import { userLists } from '@renderer/store/list/state'
import syncSourceList from '@renderer/store/list/syncSourceList'
import { retryPlaylistWriteback } from '@renderer/utils/playlistWriteback'
import { syncCookiePlaylists } from '@renderer/utils/cookieSync'
import { type CookieSource } from '@renderer/utils/cookieManager'
import { updatePlatformLists } from '@renderer/core/useApp/listAutoUpdate'
import PlatformSyncSelection from './PlatformSyncSelection.vue'
const query = ref(''); const errorsOnly = ref(false)
const retrying = reactive<Record<string, boolean>>({})
const labels = { running: '进行中', success: '成功', failed: '失败', idle: '待机' }
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
      if (!list) throw new Error('歌单已不存在')
      await syncSourceList(list)
    } else if (key.startsWith('writeback:')) await retryPlaylistWriteback(key.slice(10))
    else if (key.startsWith('cookie:')) await syncCookiePlaylists(key.split(':')[1] as CookieSource)
  } catch (error) { finishSync(key, error) } finally { retrying[key] = false }
}
</script>
<style lang="less" module>
.panel { max-width: 900px; }
.tools, .title { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.list { max-height: 400px; overflow: auto; li { padding: 12px 2px; border-bottom: 1px solid var(--color-primary-background-hover); } p { font-size: 12px; line-height: 1.7; margin-top: 6px; } }
</style>
