<template>
  <section data-plugin-settings="audio-tag-editor" :class="$style.editor" @keydown.ctrl.s.prevent.stop="save" @keydown.meta.s.prevent.stop="save">
    <p :class="$style.intro">{{ text.intro }}</p>
    <div :class="$style.toolbar">
      <base-btn min :disabled="editor.busy" @click="chooseFile">{{ text.choose }}</base-btn>
      <base-btn min outline :disabled="loadingDownloads || editor.busy" @click="refreshDownloads">{{ text.refresh }}</base-btn>
      <span :class="$style.hint">MP3 · FLAC</span>
    </div>
    <p v-if="editor.error" :class="$style.error" role="alert">{{ errorText }}</p>
    <p v-if="editor.saved" :class="$style.success" role="status">{{ text.saved }}</p>
    <div :class="$style.workspace">
      <aside :class="$style.files" :aria-label="text.downloads">
        <h4>{{ text.downloads }} <span>{{ downloads.length }}</span></h4>
        <input v-model="search" type="search" :class="$style.search" :placeholder="text.search" :aria-label="text.search" @input="visibleCount = 50">
        <p v-if="loadingDownloads" :class="$style.empty" role="status">{{ text.loading }}</p>
        <p v-else-if="downloadError" :class="$style.empty" role="alert">{{ text.downloadError }}</p>
        <ul v-else-if="filteredDownloads.length" :class="$style.fileList">
          <li v-for="item in filteredDownloads.slice(0, visibleCount)" :key="item.id">
            <button
              type="button" :class="[$style.file, {[$style.selected]: selectedId === item.id}]" :disabled="editor.busy"
              :title="item.metadata.filePath" :aria-pressed="selectedId === item.id" @click="selectDownload(item)"
            >
              <strong>{{ item.metadata.fileName }}</strong>
              <span>{{ item.metadata.musicInfo.singer || item.metadata.musicInfo.name }}</span>
            </button>
          </li>
          <li v-if="filteredDownloads.length > visibleCount"><base-btn min outline @click="visibleCount += 50">{{ text.more }}</base-btn></li>
        </ul>
        <p v-else :class="$style.empty">{{ search ? text.noMatch : text.noDownloads }}</p>
      </aside>

      <form v-if="editor.snapshot" :class="$style.form" @submit.prevent="save">
        <div :class="$style.fileInfo">
          <h4>{{ fileName }} <span v-if="dirty">{{ text.unsaved }}</span></h4>
          <p>{{ editor.snapshot.format }} · {{ (editor.snapshot.size / 1024 / 1024).toFixed(2) }} MB</p>
          <p :class="$style.path">{{ editor.snapshot.filePath }}</p>
        </div>
        <fieldset :disabled="editor.busy" :class="$style.fields">
          <label v-for="field in fieldNames" :key="field" :class="{[$style.wide]: field === 'comment'}">
            <span>{{ text.fields[field] }}</span>
            <textarea v-if="field === 'comment'" v-model="editor.tags[field]" rows="3" maxlength="10000" />
            <input v-else v-model="editor.tags[field]" type="text" maxlength="10000" :placeholder="field === 'track' || field === 'disc' ? '1/12' : ''">
          </label>
        </fieldset>
        <div :class="$style.actions">
          <base-btn min :disabled="editor.busy || !dirty" @click="save">{{ editor.busy ? text.working : text.save }}</base-btn>
          <base-btn min outline :disabled="editor.busy || !dirty" @click="reset">{{ text.reset }}</base-btn>
          <span :class="$style.hint">{{ text.shortcut }}</span>
        </div>
      </form>
      <div v-else :class="$style.placeholder" role="status">
        <svg aria-hidden="true" viewBox="0 0 24 24"><use xlink:href="#icon-music" /></svg>
        <h4>{{ text.start }}</h4>
        <p>{{ text.startHint }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ipcRenderer } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { appSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import { readTags, saveTags, supported } from './metadata'
import { editor } from './session'

const copy = {
  'zh-cn': {
    intro: '编辑音频文件内的标签，保存后可在文件属性和其他播放器中查看。原有封面、歌词和音频内容会保留。',
    choose: '选择音频文件',
    refresh: '刷新下载列表',
    downloads: '已完成的下载',
    search: '搜索文件名或艺术家',
    loading: '正在读取下载列表…',
    downloadError: '下载列表读取失败，请刷新重试，也可以直接选择音频文件。',
    noDownloads: '暂无已完成的 MP3、FLAC 下载。可点击上方按钮选择本地文件。',
    noMatch: '没有匹配的文件',
    more: '显示更多',
    start: '选择要编辑的音频文件',
    startHint: '从左侧选择已完成的下载，或打开本地 MP3、FLAC 文件。',
    unsaved: '未保存',
    saved: '标签已保存到音频文件。',
    working: '正在处理…',
    save: '保存标签',
    reset: '还原修改',
    shortcut: 'Ctrl / ⌘ + S 保存',
    discard: '当前标签有未保存的修改，是否放弃修改并打开另一个文件？',
    discardConfirm: '放弃并打开',
    cancel: '继续编辑',
    fields: { title: '标题', subtitle: '副标题', artist: '艺术家', albumArtist: '专辑艺术家', album: '专辑', year: '年份 / 日期', track: '曲目序号', disc: '光盘序号', genre: '流派', composer: '作曲者', publisher: '发行者', encodedBy: '编码人员', copyright: '版权', comment: '备注' },
    errors: {
      ENOENT: '文件不存在或已移动，请重新选择文件。',
      EACCES: '没有文件写入权限，请检查文件是否为只读。',
      EPERM: '文件无法修改，请检查写入权限，并关闭其他正在使用此文件的程序。',
      EBUSY: '文件正在被使用，请关闭占用此文件的程序后重试。',
      ENOSPC: '磁盘空间不足，无法保存标签。',
      FILE_BUSY: '此文件正在保存，请稍后重试。',
      FILE_CHANGED: '文件在打开后已被修改。请重新选择文件，读取最新标签后再保存。',
      UNSUPPORTED_FILE: '请选择 MP3 或 FLAC 音频文件。',
      UNSUPPORTED_TAG: '此 MP3 的标签格式暂不支持编辑，文件未修改。',
      INVALID_FILE: '无法读取此音频文件，文件可能损坏或格式与扩展名不一致。',
      INVALID_TAGS: '标签内容无效或过长，请检查后重试。',
      UNKNOWN: '无法读取或保存标签，请检查文件和写入权限后重试。',
    },
  },
  'en-us': {
    intro: 'Edit tags stored in audio files. Saved tags appear in file properties and other players. Existing artwork, lyrics and audio are preserved.',
    choose: 'Choose audio file',
    refresh: 'Refresh downloads',
    downloads: 'Completed downloads',
    search: 'Search filename or artist',
    loading: 'Loading downloads…',
    downloadError: 'Could not load downloads. Refresh or choose an audio file directly.',
    noDownloads: 'No completed MP3 or FLAC downloads. Choose a local file above.',
    noMatch: 'No matching files',
    more: 'Show more',
    start: 'Choose an audio file to edit',
    startHint: 'Select a completed download or open a local MP3 or FLAC file.',
    unsaved: 'Unsaved',
    saved: 'Tags saved to the audio file.',
    working: 'Working…',
    save: 'Save tags',
    reset: 'Reset changes',
    shortcut: 'Ctrl / ⌘ + S to save',
    discard: 'Discard unsaved tag changes and open another file?',
    discardConfirm: 'Discard and open',
    cancel: 'Keep editing',
    fields: { title: 'Title', subtitle: 'Subtitle', artist: 'Artist', albumArtist: 'Album artist', album: 'Album', year: 'Year / date', track: 'Track number', disc: 'Disc number', genre: 'Genre', composer: 'Composer', publisher: 'Publisher', encodedBy: 'Encoded by', copyright: 'Copyright', comment: 'Comment' },
    errors: {
      ENOENT: 'The file is missing or was moved. Choose it again.',
      EACCES: 'Write access denied. Check whether the file is read-only.',
      EPERM: 'Cannot modify the file. Check permissions and close other programs using it.',
      EBUSY: 'The file is in use. Close other programs using it and try again.',
      ENOSPC: 'Not enough disk space to save tags.',
      FILE_BUSY: 'This file is being saved. Try again shortly.',
      FILE_CHANGED: 'The file changed after it was opened. Select it again to reload its tags before saving.',
      UNSUPPORTED_FILE: 'Choose an MP3 or FLAC audio file.',
      UNSUPPORTED_TAG: 'Editing this MP3 tag format is not supported. The file was not changed.',
      INVALID_FILE: 'Cannot read this audio file. It may be damaged or have the wrong extension.',
      INVALID_TAGS: 'Tags are invalid or too long. Check them and try again.',
      UNKNOWN: 'Could not read or save tags. Check the file and its write permissions.',
    },
  },
}
const text = computed(() => copy[appSetting['common.langId']?.startsWith('zh') ? 'zh-cn' : 'en-us'])
const fieldNames = Object.keys(copy['zh-cn'].fields)
const downloads = ref([])
const loadingDownloads = ref(false)
const downloadError = ref(false)
const selectedId = ref('')
const search = ref('')
const visibleCount = ref(50)
const filteredDownloads = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return downloads.value.filter(item => `${item.metadata.fileName} ${item.metadata.musicInfo.name} ${item.metadata.musicInfo.singer}`.toLocaleLowerCase().includes(query))
})
const fileName = computed(() => editor.snapshot ? path.basename(editor.snapshot.filePath) : '')
const dirty = computed(() => editor.snapshot && fieldNames.some(key => editor.tags[key] !== editor.snapshot.tags[key]))
const errorText = computed(() => text.value.errors[editor.error] ?? text.value.errors.UNKNOWN)
watch(() => JSON.stringify(editor.tags), () => { editor.saved = false })

const refreshDownloads = async() => {
  if (loadingDownloads.value) return
  loadingDownloads.value = true
  downloadError.value = false
  try {
    const list = await ipcRenderer.invoke(WIN_MAIN_RENDERER_EVENT_NAME.download_list_get)
    downloads.value = list.filter(item => item.isComplate && supported(item.metadata.fileName))
  } catch { downloadError.value = true } finally { loadingDownloads.value = false }
}
const confirmDiscard = async() => !dirty.value || dialog.confirm({ message: text.value.discard, confirmButtonText: text.value.discardConfirm, cancelButtonText: text.value.cancel })
const report = error => { editor.error = error.code ?? 'UNKNOWN'; editor.saved = false }
const loadFile = async(filePath, id = '') => {
  const snapshot = await readTags(filePath)
  editor.snapshot = snapshot
  editor.tags = { ...snapshot.tags }
  selectedId.value = id
  editor.saved = false
}
const chooseFile = async() => {
  if (editor.busy) return
  editor.busy = true
  editor.error = ''
  try {
    const result = await ipcRenderer.invoke(WIN_MAIN_RENDERER_EVENT_NAME.show_select_dialog, {
      title: text.value.choose,
      defaultPath: appSetting['download.savePath'],
      properties: ['openFile'],
      filters: [{ name: 'MP3 / FLAC', extensions: ['mp3', 'flac'] }],
    })
    if (result.canceled || !result.filePaths.length || !await confirmDiscard()) return
    await loadFile(result.filePaths[0])
  } catch (error) { report(error) } finally { editor.busy = false }
}
const selectDownload = async(item) => {
  if (editor.busy) return
  editor.busy = true
  editor.error = ''
  try {
    if (!await confirmDiscard()) return
    let filePath = item.metadata.filePath
    if (!filePath || !await fs.stat(filePath).then(stat => stat.isFile()).catch(() => false)) filePath = path.join(appSetting['download.savePath'], item.metadata.fileName)
    await loadFile(filePath, item.id)
  } catch (error) { report(error) } finally { editor.busy = false }
}
const reset = () => {
  if (editor.busy || !editor.snapshot) return
  editor.tags = { ...editor.snapshot.tags }
  editor.error = ''
  editor.saved = false
}
const save = async() => {
  if (editor.busy || !editor.snapshot || !dirty.value) return
  editor.busy = true
  editor.error = ''
  editor.saved = false
  try {
    const snapshot = await saveTags(editor.snapshot, { ...editor.tags })
    editor.snapshot = snapshot
    editor.tags = { ...snapshot.tags }
    // Let the dirty-state watcher settle before showing the saved confirmation.
    await nextTick()
    editor.saved = true
  } catch (error) { report(error) } finally { editor.busy = false }
}
onMounted(() => { void refreshDownloads() })
</script>

<style lang="less" module>
.editor { max-width: 1000px; color: var(--color-font); font-size: 13px; line-height: 1.6; }
.intro { margin: 0 0 16px; color: var(--color-font-label); }
.toolbar, .actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.hint { color: var(--color-font-label); font-size: 12px; }
.workspace { display: grid; grid-template-columns: minmax(160px, 0.8fr) minmax(240px, 1.5fr); border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-lg); overflow: hidden; }
.files { min-width: 0; padding: 16px; border-right: 1px solid var(--color-primary-light-100-alpha-700); background: var(--color-primary-alpha-900); }
.editor h4 { margin: 0 0 12px; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.editor h4 span { font-size: 11px; color: var(--color-font-label); margin-left: 6px; font-weight: normal; }
.editor input, .editor textarea { box-sizing: border-box; width: 100%; min-width: 0; border: 1px solid var(--color-primary-light-100-alpha-700); border-radius: var(--radius-md); padding: 7px 9px; color: var(--color-font); background: var(--color-app-background); font: inherit; user-select: text; }
.editor input:focus, .editor textarea:focus { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.editor textarea { resize: vertical; }
.search { margin-bottom: 10px; }
.fileList { max-height: 500px; overflow: auto; padding: 0; margin: 0; list-style: none; }
.file { display: block; width: 100%; text-align: left; border: 1px solid transparent; border-radius: var(--radius-md); padding: 9px; margin: 3px 0; background: transparent; color: var(--color-font); cursor: pointer; }
.file strong, .file span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.file strong { font-size: 12px; font-weight: normal; }
.file span { font-size: 11px; color: var(--color-font-label); }
.file:hover, .file.selected { background: var(--color-primary-alpha-800); border-color: var(--color-primary-light-100-alpha-700); }
.file:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.file:disabled { opacity: 0.6; cursor: default; }
.form { min-width: 0; padding: 18px; }
.fileInfo { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--color-primary-light-100-alpha-700); }
.fileInfo h4 { margin-bottom: 4px; }
.fileInfo p { margin: 0; font-size: 11px; color: var(--color-font-label); }
.path { overflow-wrap: anywhere; user-select: text; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0; border: 0; margin: 0; min-width: 0; }
.fields label { min-width: 0; }
.fields label > span { display: block; margin-bottom: 4px; font-size: 12px; }
.wide { grid-column: 1 / -1; }
.actions { margin: 18px 0 0; }
.placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 300px; padding: 30px; text-align: center; color: var(--color-font-label); }
.placeholder svg { width: 48px; height: 48px; margin-bottom: 16px; color: var(--color-primary); }
.placeholder p, .empty { font-size: 12px; color: var(--color-font-label); }
.empty { padding: 16px 0; }
.error, .success { padding: 10px 12px; border-radius: var(--radius-md); margin-bottom: 14px; background: var(--color-primary-alpha-900); }
.error { border-left: 3px solid #cf5656; }
.success { color: var(--color-primary); }
@media (max-width: 850px) {
  .workspace { grid-template-columns: 1fr; }
  .files { border-right: 0; border-bottom: 1px solid var(--color-primary-light-100-alpha-700); }
  .fileList { max-height: 180px; }
}
@media (max-width: 580px) {
  .fields { grid-template-columns: 1fr; }
}
</style>
