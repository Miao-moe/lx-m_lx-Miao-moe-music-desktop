<template>
  <section data-audio-tag-editor :class="$style.editor" @keydown.ctrl.s.prevent.stop="save" @keydown.meta.s.prevent.stop="save">
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
        <p v-else-if="downloadError" :class="$style.empty" role="alert">{{ downloadError }}</p>
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
import { formatError } from '@common/utils/errorMessage'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ipcRenderer } from 'electron'
import path from 'node:path'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { appSetting } from '@renderer/store/setting'
import { getDownloads } from '@renderer/utils/downloadFiles'
import { saveTags } from './metadata'
import { canEditDownload } from './downloadFile'
import { editor } from './session'
import { text, fieldNames } from './text'
import { dirty, errorText, confirmDiscard, report, loadFile, openDownload, validateDownloadTarget, withEditorAction } from './actions'

const downloads = ref([])
const loadingDownloads = ref(false)
const downloadError = ref('')
const selectedId = computed(() => editor.downloadId)
const search = ref('')
const visibleCount = ref(50)
const filteredDownloads = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return downloads.value.filter(item => `${item.metadata.fileName} ${item.metadata.musicInfo.name} ${item.metadata.musicInfo.singer}`.toLocaleLowerCase().includes(query))
})
const fileName = computed(() => editor.snapshot ? path.basename(editor.snapshot.filePath) : '')
watch(() => JSON.stringify(editor.tags), () => { editor.saved = false })

const refreshDownloads = async() => {
  if (loadingDownloads.value) return
  loadingDownloads.value = true
  downloadError.value = ''
  try {
    const list = await getDownloads()
    downloads.value = list.filter(canEditDownload)
  } catch (error) { downloadError.value = formatError(error, text.value.downloadError, 'DOWNLOAD_LIST_LOAD_FAILED') } finally { loadingDownloads.value = false }
}
const chooseFile = async() => withEditorAction(async() => {
  const result = await ipcRenderer.invoke(WIN_MAIN_RENDERER_EVENT_NAME.show_select_dialog, {
    title: text.value.choose,
    defaultPath: appSetting['download.savePath'],
    properties: ['openFile'],
    filters: [{ name: 'MP3 / FLAC', extensions: ['mp3', 'flac'] }],
  })
  if (result.canceled || !result.filePaths.length || !await confirmDiscard()) return
  await loadFile(result.filePaths[0])
})
const selectDownload = async(item) => openDownload(item.id)
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
    await validateDownloadTarget()
    const snapshot = await saveTags(editor.snapshot, { ...editor.tags }, validateDownloadTarget)
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
.toolbar, .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
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
.form { min-width: 0; padding: 16px; }
.fileInfo { padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--color-primary-light-100-alpha-700); }
.fileInfo h4 { margin-bottom: 4px; }
.fileInfo p { margin: 0; font-size: 11px; color: var(--color-font-label); }
.path { overflow-wrap: anywhere; user-select: text; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0; border: 0; margin: 0; min-width: 0; }
.fields label { min-width: 0; }
.fields label > span { display: block; margin-bottom: 8px; font-size: 12px; }
.wide { grid-column: 1 / -1; }
.actions { margin: 16px 0 0; }
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
