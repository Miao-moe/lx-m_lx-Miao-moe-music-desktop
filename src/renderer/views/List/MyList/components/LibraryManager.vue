<template>
  <material-modal :show="visible" :bg-close="!busy" :close-btn="!busy" width="min(920px, calc(100vw - 32px))" max-width="calc(100vw - 32px)" max-height="calc(100vh - 48px)" @close="close">
    <section :class="$style.main" data-library-manager>
      <h2>歌单与本地曲库</h2>
      <nav :class="[$style.actions, $style.tabs]" aria-label="曲库管理分类">
        <base-btn v-for="(label, key) in tabs" :key="key" min :class="{ [$style.activeTab]: tab === key }" :disabled="busy" :aria-pressed="tab === key" @click="tab = key">{{ label }}</base-btn>
      </nav>
      <p v-if="error || libraryError" role="alert">{{ error || libraryError }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <p v-if="busy" role="status">正在处理…</p>
      <fieldset class="scroll" :class="$style.content" :disabled="busy" :aria-busy="busy">
        <label v-if="['organize', 'versions', 'smart', 'files'].includes(tab)" :class="$style.field">目标歌单
          <base-selection v-model="selectedList" :class="$style.fieldControl" :list="lists" item-key="id" item-name="name" aria-label="目标歌单" :disabled="busy" />
        </label>
        <transition name="library-panel" mode="out-in">
        <div :key="tab" :class="$style.tabPanel">
        <template v-if="tab === 'organize'">
          <p>自定义文件夹和置顶会显示在“我的列表”侧栏。标签用于分类，也可以在下方筛选歌单。</p>
          <label :class="$style.field">文件夹 <base-input v-model="folder" :class="$style.fieldControl" maxlength="100" placeholder="留空使用默认分组" list="library-folders" :trim="false" :disabled="busy" /></label>
          <datalist id="library-folders"><option v-for="name in folders" :key="name" :value="name" /></datalist>
          <label :class="$style.field">标签 <base-input v-model="tags" :class="$style.fieldControl" maxlength="1000" placeholder="使用逗号分隔，例如：学习、收藏" :trim="false" :disabled="busy" /></label>
          <base-checkbox id="library_pinned" v-model="pinned" :disabled="busy" label="置顶此歌单" />
          <base-btn :disabled="busy || !isUserList" @click="saveOrganization">保存分类</base-btn>
          <p v-if="!isUserList">默认列表与我的收藏固定显示在侧栏顶部。请选择自建歌单设置分类。</p>
          <label :class="$style.field">查找歌单 <base-input v-model="listSearch" :class="$style.fieldControl" placeholder="名称、文件夹或标签" :trim="false" :disabled="busy" /></label>
          <ul><li v-for="list in filteredLists" :key="list.id"><base-btn :class="$style.listSelect" outline :disabled="busy" :aria-pressed="selectedList === list.id" @click="selectedList = list.id">{{ list.name }} <small>{{ organizationLabel(list.id) }}</small></base-btn></li></ul>
        </template>
        <template v-if="tab === 'versions'">
          <p>修改前自动保存，单个歌单保留最近 20 个版本；全部历史保留最近 500 个版本，约 128 MB。恢复会先保存当前内容。</p>
          <base-btn :disabled="busy" @click="snapshot">保存当前快照</base-btn>
          <p v-if="!versions.length">暂无历史版本。</p>
          <ul><li v-for="version in versions" :key="version.id" :class="$style.row"><span>{{ date(version.time) }} · {{ version.reason }} · {{ version.count }} 首</span><base-btn min :disabled="busy" @click="previewVersion(version.id)">比较</base-btn></li></ul>
          <div v-if="diff">
            <p>与这个历史版本相比，当前歌单新增 {{ diff?.added.length }} 首、移除 {{ diff?.removed.length }} 首、修改信息 {{ diff?.changed.length }} 首、位置变化 {{ diff?.reordered }} 首。</p>
            <details v-for="(items, label) in { '新增': diff?.added ?? [], '移除': diff?.removed ?? [], '信息变化': diff?.changed ?? [] }" :key="label"><summary>{{ label }}（{{ items.length }}）</summary><p v-for="song in items.slice(0, 100)" :key="song.id">{{ song.name }} — {{ song.singer }}</p><p v-if="items.length > 100">仅展示前 100 首。</p></details>
            <base-btn :disabled="busy" @click="restoreVersion">恢复此版本</base-btn>
          </div>
        </template>
        <template v-if="tab === 'smart'">
          <p>保存规则后，这个歌单会自动按条件更新。现有歌曲会被替换，修改前会保存历史版本。也可以先创建新的智能歌单。</p>
          <label :class="$style.field">新歌单名称 <base-input v-model="smartName" :class="$style.fieldControl" maxlength="100" placeholder="例如：最近收藏" :trim="false" :disabled="busy" /></label>
          <base-btn :disabled="busy || !smartName" @click="createSmart">创建歌单</base-btn>
          <label :class="$style.field">条件 <base-selection v-model="smart.kind" :class="$style.fieldControl" :list="smartKinds" item-key="id" item-name="name" aria-label="条件" :disabled="busy" /></label>
          <label v-if="smart.kind !== 'downloaded'" :class="$style.field">天数 <base-input :model-value="smart.days" :class="$style.fieldControl" type="number" min="1" max="36500" :disabled="busy" @update:model-value="smart.days = Number($event)" /></label>
          <label :class="$style.field">歌曲来源 <base-selection v-model="smart.sourceList" :class="$style.fieldControl" :list="smartSourceOptions" item-key="id" item-name="name" aria-label="歌曲来源" :disabled="busy" /></label>
          <p>旧数据没有可靠的添加日期，不计入“最近添加”；听歌记录从本次更新后开始累计。</p>
          <div :class="$style.actions"><base-btn :disabled="busy || !isUserList" @click="saveSmart">保存规则并更新</base-btn><base-btn :disabled="busy || !isUserList" @click="disableSmart">转为普通歌单</base-btn></div>
          <p v-if="!isUserList">请创建或选择一个自建歌单来保存智能规则。</p>
        </template>
        <template v-if="tab === 'files'">
          <p>选择音乐文件夹后，新增音频会自动加入目标歌单。缺失文件会保留记录并标记；停止监测不删除文件或歌曲。</p>
          <div :class="$style.actions"><base-btn :disabled="busy || libraryScanning" @click="addFolder">添加监测文件夹</base-btn><base-btn :disabled="busy || libraryScanning" @click="scan">立即扫描与检查</base-btn><base-btn :disabled="busy || libraryScanning" @click="readTags">重新读取本地标签</base-btn></div>
          <p v-if="libraryScanning">正在扫描音乐文件夹…</p>
          <ul><li v-for="(entry, index) in libraryPreferences.folders" :key="entry.path + entry.listId" :class="$style.folder"><strong>{{ entry.path }}</strong><p>加入：{{ lists.find(list => list.id === entry.listId)?.name ?? '歌单已删除' }}</p><base-checkbox :id="'library_watch_' + index" :model-value="entry.enabled" controlled :disabled="busy" label="监测此文件夹" @update:model-value="toggleFolder(entry)" /> <base-btn min :disabled="busy" @click="removeFolder(entry)">移除监测</base-btn><p :class="$style.status">{{ folderScanResults[entry.path] }}</p></li></ul>
          <h3>文件移动后重新关联</h3><p>在新位置查找同名文件，并核对文件大小、歌手、专辑和时长。多个候选时不自动替换。确认后只更新歌曲路径。</p>
          <base-btn :disabled="busy" @click="findMoved">选择新文件夹并预览</base-btn>
          <template v-if="relocation"><p>可重新关联 {{ relocation?.replacements.length }} 首，未确定 {{ relocation?.unresolved.length }} 首。</p><p v-for="item in relocation?.replacements.slice(0, 50) ?? []" :key="item.before.id">{{ item.before.meta.filePath }} → {{ item.after.meta.filePath }}</p><details><summary>无法确定的文件</summary><p v-for="filename in relocation?.unresolved ?? []" :key="filename">{{ filename }}</p></details><base-btn :disabled="busy || !relocation?.replacements.length" @click="applyRelocation">确认重新关联</base-btn></template>
        </template>
        <template v-if="tab === 'browse'">
          <form :class="$style.actions" @submit.prevent="catalogPage = 0; loadCatalog()"><label>搜索 <base-input v-model="catalogQuery.search" :class="$style.fieldControl" placeholder="歌名、歌手、专辑" :trim="false" :disabled="busy" /></label><base-btn :disabled="busy" type="submit">搜索</base-btn></form>
          <div :class="$style.actions">
            <label>歌手 <base-selection :model-value="catalogQuery.singer ?? ''" :class="$style.facetSelection" :list="singerOptions" item-key="id" item-name="name" aria-label="歌手" :disabled="busy" @update:model-value="catalogQuery.singer = $event || undefined" @change="catalogPage = 0; loadCatalog()" /></label>
            <label>专辑 <base-selection :model-value="catalogQuery.album ?? ''" :class="$style.facetSelection" :list="albumOptions" item-key="id" item-name="name" aria-label="专辑" :disabled="busy" @update:model-value="catalogQuery.album = $event || undefined" @change="catalogPage = 0; loadCatalog()" /></label>
            <label>年份 <base-selection :model-value="catalogQuery.year ?? ''" :class="$style.facetSelection" :list="yearOptions" item-key="id" item-name="name" aria-label="年份" :disabled="busy" @update:model-value="catalogQuery.year = $event || undefined" @change="catalogPage = 0; loadCatalog()" /></label>
            <base-checkbox id="library_missing" :model-value="!!catalogQuery.missing" :disabled="busy" label="只看失效文件" @update:model-value="catalogQuery.missing = $event; catalogPage = 0; loadCatalog()" />
          </div>
          <p>共 {{ catalog.count }} 首；每页 50 首。</p>
          <ul><li v-for="{ song, missing } in catalog.songs" :key="song.id" :class="$style.row"><span>{{ song.name }} — {{ song.singer || '未知歌手' }}<small>{{ song.meta.albumName }} {{ song.source === 'local' ? song.meta.year : '' }} <strong v-if="missing">文件失效</strong></small></span><base-btn min :disabled="missing" @click="play(song)">播放</base-btn></li></ul>
          <div :class="$style.actions"><base-btn :disabled="busy || catalogPage === 0" @click="catalogPage--; loadCatalog()">上一页</base-btn><span>{{ catalogPage + 1 }}</span><base-btn :disabled="busy || (catalogPage + 1) * 50 >= catalog.count" @click="catalogPage++; loadCatalog()">下一页</base-btn></div>
        </template>
        <template v-if="tab === 'listening'">
          <form :class="$style.actions" @submit.prevent="historyPage = 0; loadListening()"><label>从 <base-input v-model="fromDate" type="date" :disabled="busy" /></label><label>到 <base-input v-model="toDate" type="date" :disabled="busy" /></label><label>搜索 <base-input v-model="historySearch" :class="$style.fieldControl" placeholder="歌名或歌手" :trim="false" :disabled="busy" /></label><base-btn type="submit" :disabled="busy">查询</base-btn></form>
          <p>共播放 {{ listening.stats.plays }} 次、{{ listening.stats.songs }} 首歌曲、{{ listening.stats.singers }} 位歌手。按实际开始播放计数，保留最近 50,000 条。</p>
          <p v-if="listening.artists.length">常听歌手：{{ listening.artists.map(item => `${item.singer || '未知'}（${item.count} 次）`).join('、') }}</p>
          <ul><li v-for="entry in listening.rows" :key="entry.id" :class="$style.row"><span>{{ date(entry.time) }}<small>{{ entry.song.name }} — {{ entry.song.singer }}</small></span><base-btn min @click="play(entry.song)">播放</base-btn></li></ul>
          <div :class="$style.actions"><base-btn :disabled="busy || historyPage === 0" @click="historyPage--; loadListening()">上一页</base-btn><span>{{ historyPage + 1 }}</span><base-btn :disabled="busy || (historyPage + 1) * 50 >= listening.stats.plays" @click="historyPage++; loadListening()">下一页</base-btn><base-btn :disabled="busy" @click="clearListening">清空听歌记录</base-btn></div>
        </template>
        </div>
        </transition>
      </fieldset>
      <footer><base-btn :disabled="busy" @click="close">关闭</base-btn></footer>
    </section>
  </material-modal>
</template>
<script setup lang="ts">
import { computed, ref, watch, toRaw } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { formatError } from '@common/utils/errorMessage'
import { type HistoryVersion, type HistoryDiff, type LibraryFolder, type LibraryQuery, type LibraryService, type SmartRule } from '@common/library'
import { libraryCall, libraryPreferences, libraryError, refreshLibraryPreferences, saveLibraryPreferences } from '@renderer/utils/library'
import { refreshLibrary, checkLibraryFiles, refreshSmartPlaylist, folderScanResults, libraryScanning } from '@renderer/utils/libraryMaintenance'
import { userLists, overwriteListMusics, updateListMusics, getMusicExistListIds } from '@renderer/store/list/listManage'
import { createUserList } from '@renderer/store/list/action'
import { addTempPlayList } from '@renderer/store/player/action'
import { playMusicInfo } from '@renderer/store/player/state'
import { playQueueById } from '@renderer/core/player'
import { showSelectDialog } from '@renderer/utils/ipc'
import { dialog } from '@renderer/plugins/Dialog'
const props = defineProps<{ visible: boolean, listId: string }>()
const emit = defineEmits<(event: 'update:visible', value: boolean) => void>()
const tabs = { organize: '分类与置顶', versions: '歌单历史', smart: '智能歌单', files: '文件管理', browse: '本地曲库', listening: '听歌历史' }
const smartKinds = [{ id: 'recent', name: '最近添加' }, { id: 'unplayed', name: '久未播放（含从未播放）' }, { id: 'downloaded', name: '已下载完成' }]
const tab = ref<keyof typeof tabs>('organize')
const busy = ref(false)
const error = ref('')
const message = ref('')
const selectedList = ref(props.listId)
const lists = computed(() => [{ id: LIST_IDS.DEFAULT, name: '默认列表' }, { id: LIST_IDS.LOVE, name: '我的收藏' }, ...userLists])
const isUserList = computed(() => userLists.some(list => list.id === selectedList.value))
const sourceLists = computed(() => lists.value.filter(list => list.id !== selectedList.value && !libraryPreferences.value.lists[list.id]?.smart))
const smartSourceOptions = computed(() => [{ id: '', name: '所有普通歌单' }, ...sourceLists.value])
const folder = ref('')
const tags = ref('')
const pinned = ref(false)
const listSearch = ref('')
const folders = computed(() => [...new Set(Object.values(libraryPreferences.value.lists).map(info => info.folder).filter(Boolean))])
const organizationLabel = (id: string) => { const info = libraryPreferences.value.lists[id]; return info ? [info.pinned ? '置顶' : '', info.folder, ...info.tags].filter(Boolean).join(' / ') : '' }
const filteredLists = computed(() => lists.value.filter(list => `${list.name} ${organizationLabel(list.id)}`.toLowerCase().includes(listSearch.value.toLowerCase())))
const smartName = ref('')
const smart = ref<SmartRule>({ kind: 'recent', days: 30, sourceList: '' })
const versions = ref<HistoryVersion[]>([])
const diff = ref<HistoryDiff | null>(null)
const previewId = ref(0)
const catalogQuery = ref<LibraryQuery>({})
const catalogPage = ref(0)
const catalog = ref<ReturnType<LibraryService['getLibraryCatalog']>>({ songs: [], count: 0 })
const facets = ref<ReturnType<LibraryService['getLibraryFacets']>>({ singers: [], albums: [], years: [] })
const singerOptions = computed(() => [{ id: '', name: '全部' }, ...facets.value.singers.map(item => ({ id: item.value, name: `${item.value || '未知歌手'}（${item.count}）` }))])
const albumOptions = computed(() => [{ id: '', name: '全部' }, ...facets.value.albums.map(item => ({ id: item.value, name: `${item.value || '未知专辑'}（${item.count}）` }))])
const yearOptions = computed(() => [{ id: '', name: '全部' }, ...facets.value.years.map(item => ({ id: item.value, name: `${item.value}（${item.count}）` }))])
const historyPage = ref(0)
const historySearch = ref('')
const fromDate = ref('')
const toDate = ref('')
const listening = ref<ReturnType<LibraryService['getListeningHistory']>>({ rows: [], stats: { plays: 0, songs: 0, singers: 0 }, artists: [] })
const relocation = ref<Awaited<ReturnType<typeof window.lx.worker.main.planLibraryRelocation>> | null>(null)
const close = () => { if (!busy.value) emit('update:visible', false) }
const date = (time: number) => new Date(time).toLocaleString()
const run = async(action: () => Promise<void>) => {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try { await action() } catch (e) { error.value = formatError(e, '曲库操作失败') } finally { busy.value = false }
}
const copyPrefs = () => JSON.parse(JSON.stringify(libraryPreferences.value)) as typeof libraryPreferences.value
const syncFields = () => {
  const info = libraryPreferences.value.lists[selectedList.value]
  folder.value = info?.folder ?? ''; tags.value = info?.tags.join(', ') ?? ''; pinned.value = info?.pinned ?? false
  smart.value = { ...(info?.smart ?? { kind: 'recent', days: 30, sourceList: '' }) }
  diff.value = null
}
const saveOrganization = async() => run(async() => {
  const prefs = copyPrefs()
  prefs.lists[selectedList.value] = { ...prefs.lists[selectedList.value], folder: folder.value.trim(), tags: [...new Set(tags.value.split(/[,，、]/).map(tag => tag.trim()).filter(Boolean))], pinned: pinned.value }
  await saveLibraryPreferences(prefs); message.value = '分类已保存'
})
const snapshot = async() => run(async() => { await libraryCall('captureListHistory', selectedList.value, '手动保存'); versions.value = await libraryCall('getListHistory', selectedList.value); message.value = '快照已保存；相同内容不会重复保存' })
const previewVersion = async(id: number) => run(async() => { diff.value = await libraryCall('getListHistoryDiff', id); previewId.value = id })
const restoreVersion = async() => {
  if (!diff.value || !await dialog.confirm({ message: '将歌曲内容与顺序恢复到此版本？当前内容会先保存为历史版本。', confirmButtonText: '恢复' })) return
  await run(async() => { const version = await libraryCall('getListHistoryDiff', previewId.value); await overwriteListMusics({ listId: version.listId, musicInfos: version.songs }); versions.value = await libraryCall('getListHistory', selectedList.value); diff.value = null; message.value = '已恢复歌单' })
}
const createSmart = async() => run(async() => { const id = `userlist_smart_${Date.now()}`; await createUserList({ id, name: smartName.value }); selectedList.value = id; smartName.value = ''; message.value = '歌单已创建，请保存筛选规则' })
const saveSmart = async() => {
  if (!await dialog.confirm({ message: '按规则更新这个歌单？当前内容会先保存为历史版本。', confirmButtonText: '保存并更新' })) return
  await run(async() => { const prefs = copyPrefs(); prefs.lists[selectedList.value] = { ...(prefs.lists[selectedList.value] ?? { folder: '', tags: [], pinned: false }), smart: { ...smart.value } }; await saveLibraryPreferences(prefs); await refreshSmartPlaylist(selectedList.value); message.value = '智能歌单已更新' })
}
const disableSmart = async() => run(async() => { const prefs = copyPrefs(); if (prefs.lists[selectedList.value]) delete prefs.lists[selectedList.value].smart; await saveLibraryPreferences(prefs); message.value = '已保留当前歌曲并停止自动更新' })
const chooseDirectory = async() => { const result = await showSelectDialog({ properties: ['openDirectory'] }); return result.canceled ? undefined : result.filePaths[0] }
const addFolder = async() => run(async() => { const path = await chooseDirectory(); if (!path) return; const prefs = copyPrefs(); if (!prefs.folders.some(item => item.path === path && item.listId === selectedList.value)) prefs.folders.push({ path, listId: selectedList.value, enabled: true }); await saveLibraryPreferences(prefs); await refreshLibrary() })
const toggleFolder = async(entry: LibraryFolder) => run(async() => { const prefs = copyPrefs(); const item = prefs.folders.find(item => item.path === entry.path && item.listId === entry.listId)!; item.enabled = !item.enabled; await saveLibraryPreferences(prefs); if (item.enabled) await refreshLibrary() })
const removeFolder = async(entry: LibraryFolder) => run(async() => { const prefs = copyPrefs(); prefs.folders = prefs.folders.filter(item => item.path !== entry.path || item.listId !== entry.listId); await saveLibraryPreferences(prefs) })
const scan = async() => run(async() => { await refreshLibrary(); message.value = `检查完成，${await checkLibraryFiles()} 首文件失效；可在“本地曲库”中筛选查看` })
const updateEveryList = async(songs: LX.Music.MusicInfo[]) => {
  const updates: LX.List.ListActionMusicUpdate = []
  for (const song of songs) { const ids = await getMusicExistListIds(song.id); updates.push(...ids.map(id => ({ id, musicInfo: song }))) }
  if (updates.length) await updateListMusics(updates)
}
const readTags = async() => run(async() => {
  const songs = await libraryCall('getLibraryLocalFiles'); let count = 0; const failures: string[] = []
  for (let index = 0; index < songs.length; index += 50) {
    const batch = songs.slice(index, index + 50); const result = await window.lx.worker.main.importLibraryFiles(batch.map(song => song.meta.filePath)); failures.push(...result.errors)
    const old = new Map(batch.map(song => [song.meta.filePath, song]))
    await updateEveryList(result.songs.map(song => ({ ...song, id: old.get(song.meta.filePath)!.id })))
    count += result.songs.length
    message.value = `正在读取本地标签：${Math.min(index + 50, songs.length)} / ${songs.length}`
  }
  message.value = `已更新 ${count} 首的本地标签`; if (failures.length) error.value = failures.join('\n')
})
const findMoved = async() => run(async() => { const directory = await chooseDirectory(); if (!directory) return; relocation.value = await window.lx.worker.main.planLibraryRelocation(await libraryCall('getLibraryLocalFiles'), directory); if (relocation.value.errors.length) error.value = relocation.value.errors.join('\n') })
const applyRelocation = async() => run(async() => {
  const songs = relocation.value!.replacements.map(item => toRaw(item.after))
  const states = await window.lx.worker.main.inspectLibraryFiles(songs)
  if (states.some(item => item.missing)) throw Object.assign(new Error('候选文件已经移动，请重新扫描'), { code: 'LIBRARY_RELINK_STALE' })
  await updateEveryList(songs)
  await checkLibraryFiles(); relocation.value = null; message.value = '歌曲路径已更新'
})
const loadCatalog = async() => run(async() => { catalog.value = await libraryCall('getLibraryCatalog', { ...catalogQuery.value, page: catalogPage.value }) })
const loadListening = async() => run(async() => {
  const from = fromDate.value ? new Date(fromDate.value + 'T00:00:00').getTime() : undefined
  const to = toDate.value ? new Date(toDate.value + 'T23:59:59.999').getTime() : undefined
  if (from && to && from > to) throw Object.assign(new Error('开始日期不能晚于结束日期'), { code: 'HISTORY_DATE_INVALID' })
  listening.value = await libraryCall('getListeningHistory', { from, to, search: historySearch.value, page: historyPage.value })
})
const clearListening = async() => { if (!await dialog.confirm({ message: '清空全部本地听歌记录和相关统计？', confirmButtonText: '清空' })) return; await run(async() => { await libraryCall('clearListeningHistory'); listening.value = await libraryCall('getListeningHistory'); historyPage.value = 0; fromDate.value = ''; toDate.value = ''; historySearch.value = '' }) }
const play = (song: LX.Music.MusicInfo) => { const playing = !!playMusicInfo.musicInfo; const index = addTempPlayList([{ listId: null, musicInfo: song }]); if (playing) playQueueById(index) }
watch([() => props.visible, tab, selectedList], async() => {
  syncFields()
  if (!props.visible) return
  if (tab.value === 'browse') { await run(async() => { facets.value = await libraryCall('getLibraryFacets') }); await loadCatalog() } else if (tab.value === 'listening') await loadListening()
  else if (tab.value === 'versions') await run(async() => { versions.value = await libraryCall('getListHistory', selectedList.value) })
}, { immediate: true })
watch(() => props.visible, async(visible) => { if (visible) { selectedList.value = props.listId; await run(async() => { await refreshLibraryPreferences(); syncFields() }) } }, { immediate: true })
</script>
<style lang="less" module>
.main { padding: 20px; display: flex; flex-direction: column; gap: 12px; max-height: calc(100vh - 88px); line-height: 1.6; box-sizing: border-box; h2 { font-size: 20px; } h3 { margin-top: 20px; font-size: 16px; } p { margin: 8px 0; } li { padding: 6px 0; } small { display: block; opacity: .8; } }
.content { overflow: auto; min-height: 0; min-width: 0; flex: 1; padding: 0 4px; margin: 0; border: 0; }
.actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; label { display: inline-flex; flex: none; align-items: center; gap: 6px; white-space: nowrap; } .fieldControl { max-width: 220px; } }
.tabs { flex: none; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 2px; }
.tabs .activeTab { color: var(--color-primary); background-color: var(--color-selected); }
.field { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
.fieldControl { min-width: 0; width: 100%; max-width: 440px; --selection-width: 100%; }
.field > .fieldControl { flex: 1; }
.facetSelection { --selection-width: 180px; max-width: 180px; }
.listSelect { display: block; width: 100%; text-align: left; }
.listSelect[aria-pressed='true'] { color: var(--color-primary); background-color: var(--color-selected); }
.tabPanel { min-width: 0; }
:global(.library-panel-enter-active), :global(.library-panel-leave-active) { transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }
:global(.library-panel-enter-from), :global(.library-panel-leave-to) { opacity: 0; transform: translateY(5px); }
.row { display: flex; gap: 12px; justify-content: space-between; border-bottom: 1px solid var(--color-200); span { min-width: 0; overflow-wrap: anywhere; } }
.folder { border-bottom: 1px solid var(--color-200); overflow-wrap: anywhere; }
.status { white-space: pre-wrap; }
</style>
