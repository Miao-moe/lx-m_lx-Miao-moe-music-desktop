<template>
  <section :class="$style.panel">
    <h3>平台歌单同步范围</h3>
    <p class="p small">用于 Cookie 歌单同步和启动同步。可只同步选中的歌单，也可忽略指定歌单；不会删除已经存在的本地歌单。</p>
    <div :class="$style.tools">
      <base-selection v-model="source" :list="sourceOptions" item-key="id" item-name="name" aria-label="选择平台" :style="{ '--selection-width': '128px' }" @change="loadSelection" />
      <base-selection v-model="mode" :list="modeOptions" item-key="id" item-name="name" aria-label="同步范围" :style="{ '--selection-width': '150px' }" />
      <base-btn min :disabled="busy" @click="load">读取平台歌单</base-btn>
      <base-btn min :disabled="saving" @click="save">保存同步范围</base-btn>
      <base-input v-model="query" placeholder="搜索歌单" :auto-paste="false" />
    </div>
    <p class="p small" role="status">{{ message }}</p>
    <div v-if="lists.length" :class="$style.tools"><base-btn min @click="selectVisible(true)">选中筛选结果</base-btn><base-btn min @click="selectVisible(false)">取消筛选结果</base-btn><span>已选 {{ ids.length }} 个</span></div>
    <div class="scroll" :class="$style.list">
      <base-checkbox v-for="list in filtered" :id="'sync_selection_' + source + '_' + list.id" :key="list.id" controlled :model-value="ids.includes(list.id)" :label="list.name" @update:model-value="toggle(list.id, $event)" />
    </div>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from '@common/utils/vueTools'
import { appSetting } from '@renderer/store/setting'
import { updateSetting } from '@renderer/utils/ipc'
import { COOKIE_SOURCES as sources, SOURCE_NAME as names, getCookie, type CookieSource } from '@renderer/utils/cookieManager'
import { getRemotePlaylists, type RemotePlaylist } from '@renderer/utils/cookiePlaylistApi'
import { formatError } from '@common/utils/errorMessage'
import { readPlatformSelection } from '@renderer/utils/platformSyncSelection'
const source = ref<CookieSource>('wy'); const mode = ref<'all' | 'include' | 'exclude'>('all'); const ids = ref<string[]>([]); const lists = ref<RemotePlaylist[]>([])
const sourceOptions = sources.map(id => ({ id, name: names[id] }))
const modeOptions = [{ id: 'all', name: '全部歌单' }, { id: 'include', name: '仅选中的歌单' }, { id: 'exclude', name: '忽略选中的歌单' }]
const busy = ref(false); const saving = ref(false); const message = ref(''); const query = ref('')
let generation = 0
const filtered = computed(() => lists.value.filter(list => list.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const loadSelection = () => {
  generation++; busy.value = false; lists.value = []; message.value = ''
  const value = readPlatformSelection(appSetting['sync.platform.selection'])[source.value]
  mode.value = value?.mode ?? 'all'; ids.value = [...(value?.ids ?? [])]
}
loadSelection()
const toggle = (id: string, value: boolean) => { ids.value = value ? [...new Set([...ids.value, id])] : ids.value.filter(item => item !== id) }
const selectVisible = (value: boolean) => { const selected = new Set(ids.value); for (const list of filtered.value) { if (value) selected.add(list.id); else selected.delete(list.id) } ids.value = [...selected] }
const load = async() => {
  const current = ++generation; busy.value = true; message.value = ''
  try {
    const result = await getRemotePlaylists(source.value, getCookie(source.value))
    if (current === generation) { lists.value = result; message.value = `已读取 ${result.length} 个歌单` }
  } catch (error) { if (current === generation) message.value = formatError(error, '读取平台歌单失败', 'PLAYLIST_SELECTION_FAILED') } finally { if (current === generation) busy.value = false }
}
const save = async() => {
  saving.value = true
  try {
    await updateSetting({ 'sync.platform.selection': JSON.stringify({ ...readPlatformSelection(appSetting['sync.platform.selection']), [source.value]: { mode: mode.value, ids: [...ids.value] } }) })
    message.value = '同步范围已保存'
  } catch (error) { message.value = formatError(error, '保存同步范围失败', 'SYNC_SELECTION_SAVE_FAILED') } finally { saving.value = false }
}
onBeforeUnmount(() => { generation++ })
</script>
<style lang="less" module>
.panel { padding: 8px 15px 16px; box-sizing: border-box; }
.tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; }
.list { max-height: 240px; overflow: auto; display: flex; flex-direction: column; gap: 8px; margin-top: 8px; font-size: 13px; }
</style>
