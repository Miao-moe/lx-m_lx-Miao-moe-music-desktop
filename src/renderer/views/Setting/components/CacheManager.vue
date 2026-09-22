<template>
  <div data-cache-manager>
    <p>包含可重新获取的封面、歌词、播放地址和本地临时封面。已下载歌曲、自定义歌词和歌单会保留。内存占用单独显示；正在显示的封面在离开界面后释放。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-for="(label, key) in labels" :key="key" :class="$style.row">
      <span>{{ label }}：{{ sizeFormate(usage[key] ?? 0) }}</span>
      <base-btn min :disabled="busy" @click="clear(key)">清理</base-btn>
    </div>
    <div :class="$style.row">
      <base-btn min :disabled="busy" @click="clear()">清理全部缓存</base-btn>
      <base-btn min :disabled="busy" @click="refresh">刷新占用</base-btn>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref } from '@common/utils/vueTools'
import { sizeFormate } from '@common/utils/common'
import { formatError } from '@common/utils/errorMessage'
import { getCacheUsage, clearManagedCache, type CacheCategory } from '@renderer/utils/cacheManagement'
const labels: Record<CacheCategory, string> = { browser: '网页资源', covers: '封面磁盘缓存', temporary: '本地临时封面', lyrics: '在线歌词', urls: '播放地址', sources: '换源信息', memory: '共享封面内存（含解码）', metadata: '本地标签内存（估算）' }
const usage = ref<Partial<Record<CacheCategory, number>>>({})
const error = ref('')
const busy = ref(false)
const refresh = async() => {
  busy.value = true
  error.value = ''
  try { usage.value = await getCacheUsage() } catch (e) { error.value = formatError(e, '读取缓存占用失败') } finally { busy.value = false }
}
const clear = async(category?: CacheCategory) => {
  busy.value = true
  error.value = ''
  try { await clearManagedCache(category); await refresh() } catch (e) { error.value = formatError(e, '清理缓存失败') } finally { busy.value = false }
}
void refresh()
</script>
<style lang="less" module>
.row { display: flex; gap: 16px; align-items: center; margin-top: 8px; }
</style>
