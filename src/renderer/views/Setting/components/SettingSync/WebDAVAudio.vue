<template>
  <section :class="$style.panel" aria-label="WebDAV 音频目录">
    <h3>WebDAV 音频目录</h3>
    <p class="p small">使用上方已保存的连接。浏览服务器目录，直接播放音频；支持拖动播放进度。</p>
    <div :class="$style.tools">
      <base-btn min :disabled="busy" @click="browse('')">打开根目录</base-btn>
      <base-btn min :disabled="busy || !current" @click="browse(parent)">上一级</base-btn>
      <base-input v-model="query" placeholder="筛选文件名" :auto-paste="false" />
      <span>{{ current || '/' }}</span>
    </div>
    <p v-if="busy" role="status">正在读取目录…</p>
    <p v-if="error" class="p load-error-detail" role="alert">{{ error }}</p>
    <ul v-if="loaded" class="scroll" :class="$style.list">
      <li v-for="entry in filtered" :key="entry.path">
        <button :disabled="busy" @click="entry.directory ? browse(entry.path) : play(entry)">{{ entry.directory ? '📁' : '▶' }} {{ entry.name }}</button>
        <span>{{ entry.directory ? '文件夹' : entry.size ? (entry.size / 1048576).toFixed(1) + ' MB' : '音频' }}</span>
      </li>
      <li v-if="!filtered.length">此目录没有可播放的音频或子文件夹。</li>
    </ul>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from '@common/utils/vueTools'
import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { LIST_IDS } from '@common/constants'
import { formatError, getErrorInfo } from '@common/utils/errorMessage'
import { parseAudioDirectory, audioSong, type AudioDirectory, type AudioEntry } from '@renderer/utils/webdavAudio'
import { setTempList } from '@renderer/store/list/action'
import { playList } from '@renderer/core/player'
const busy = ref(false); const loaded = ref(false); const error = ref(''); const current = ref(''); const query = ref(''); const identity = ref('')
const entries = ref<AudioEntry[]>([])
let generation = 0
const explainError = (cause: unknown, context: string, fallback: string) => {
  const { code, reason } = getErrorInfo(cause, fallback)
  const known = ['invalid_config', 'network', 'timeout', 'auth', 'http', 'invalid_data', 'too_large', 'redirect'].includes(code)
  return formatError({ code: known ? `WEBDAV_${code.toUpperCase()}` : code, message: known ? window.i18n.t(`setting__sync_webdav_error_${code as LX.WebDAV.ErrorCode}`) : reason }, context)
}
const parent = computed(() => { const path = current.value.replace(/\/$/, '').split('/').slice(0, -1).join('/'); return path ? path + '/' : '' })
const filtered = computed(() => entries.value.filter(item => item.name.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())))
const browse = async(path: string) => {
  const request = ++generation
  busy.value = true; error.value = ''
  try {
    const data = await rendererInvoke<string, AudioDirectory>(WIN_MAIN_RENDERER_EVENT_NAME.webdav_browse, path)
    if (request !== generation) return
    entries.value = parseAudioDirectory(data); identity.value = data.identity
    current.value = new URL(data.url).pathname.slice(new URL(data.root).pathname.length); loaded.value = true
  } catch (cause) { if (request === generation) error.value = explainError(cause, '读取音频目录失败', 'WEBDAV_DIRECTORY_FAILED') } finally { if (request === generation) busy.value = false }
}
const play = async(entry: AudioEntry) => {
  error.value = ''
  try {
    const files = filtered.value.filter(item => !item.directory)
    await setTempList('webdav', files.map(item => audioSong(item, identity.value)))
    playList(LIST_IDS.TEMP, files.findIndex(item => item.path === entry.path))
  } catch (cause) { error.value = explainError(cause, '播放 WebDAV 音频失败', 'WEBDAV_PLAY_FAILED') }
}
onBeforeUnmount(() => { generation++ })
</script>
<style lang="less" module>
.panel { margin-top: 20px; }
.tools { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 13px; input { max-width: 220px; } }
.list { max-height: 300px; overflow: auto; margin-top: 10px; li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; font-size: 13px; } button { flex: 1; color: inherit; text-align: left; border: none; padding: 7px; background: var(--color-primary-background-hover); cursor: pointer; overflow-wrap: anywhere; } span { flex: none; } }
</style>
