import { ipcRenderer } from 'electron'
import { computed, reactive, shallowRef } from '@common/utils/vueTools'
import { PLUGIN_IPC, type PluginId, type PluginStoreSnapshot, type PluginTransferLabels, type PluginTransferResult } from '@common/optionalPlugins'
import { createPluginRuntime } from '@common/optionalPluginRuntime'
import * as player from '@renderer/plugins/player'
import * as settings from './setting'
import { isPlay, musicInfo, isShowPlayerDetail } from './player/state'
import { lyric as lyricState } from './player/lyric'
import { playProgress } from './player/playProgress'
import { dialog } from '@renderer/plugins/Dialog'
import { setDesktopAnalyserProvider, getRawLyricLines } from '@renderer/core/lyric'
import { getUserSoundEffectConvolutionPresetList, getUserSoundEffectEQPresetList, saveUserSoundEffectConvolutionPresetList, saveUserSoundEffectEQPresetList } from '@renderer/utils/ipc'
import * as downloadFiles from '@renderer/utils/downloadFiles'
import { useI18n } from '@renderer/plugins/i18n'

export const pluginRuntime = createPluginRuntime({
  player,
  settings,
  downloadFiles,
  playerState: { isPlay, musicInfo, isShowPlayerDetail },
  mainLyricState: { lyric: lyricState },
  playProgress: { playProgress },
  dialog: { dialog },
  lyric: { setDesktopAnalyserProvider, getRawLyricLines },
  ipc: { getUserSoundEffectConvolutionPresetList, getUserSoundEffectEQPresetList, saveUserSoundEffectConvolutionPresetList, saveUserSoundEffectEQPresetList },
})
export const pluginStore = shallowRef<PluginStoreSnapshot>({ revision: -1, catalog: [], installed: {}, errors: {}, catalogError: null })
export const pluginBusy = reactive<Partial<Record<PluginId, boolean>>>({})
export const pluginOperationErrors = reactive<Partial<Record<PluginId, string>>>({})
export const visualizerInstalled = computed(() => !!pluginRuntime.components['audio-visualizer'])
export const pluginStoreError = shallowRef<string | null>(null)
export const pluginTransferBusy = shallowRef(false)
export const pluginTransferNotice = shallowRef<{ message: string, error: boolean } | null>(null)

const applySnapshot = async(snapshot: PluginStoreSnapshot) => {
  if (snapshot.revision < pluginStore.value.revision) return
  pluginStore.value = snapshot
  await pluginRuntime.sync(snapshot)
}
export const refreshPlugins = async() => {
  pluginStoreError.value = null
  try { await applySnapshot(await ipcRenderer.invoke(PLUGIN_IPC.refresh)) } catch (error: any) { pluginStoreError.value = error.message }
}
export const changePluginInstallation = async(id: PluginId, install: boolean) => {
  if (pluginBusy[id] || pluginTransferBusy.value) return
  pluginBusy[id] = true
  Reflect.deleteProperty(pluginOperationErrors, id)
  try {
    if (!install) await pluginRuntime.unload(id)
    await applySnapshot(await ipcRenderer.invoke(install ? PLUGIN_IPC.install : PLUGIN_IPC.uninstall, id))
  } catch (error: any) {
    pluginOperationErrors[id] = error.message
    await applySnapshot(await ipcRenderer.invoke(PLUGIN_IPC.list)).catch(console.error)
  } finally {
    pluginBusy[id] = false
    pluginTransferNotice.value = null
  }
}

export const transferPlugin = async(id?: PluginId) => {
  if (pluginTransferBusy.value || Object.values(pluginBusy).some(Boolean)) return
  pluginTransferBusy.value = true
  pluginTransferNotice.value = null
  const t = useI18n()
  const labels: PluginTransferLabels = {
    title: t(id ? 'setting__plugins_export' : 'setting__plugins_import'),
    filter: t('setting__plugins_package'),
    confirm: t('setting__plugins_confirm_import'),
    cancel: t('cancel_button_text'),
    trust: t('setting__plugins_import_trust'),
    install: t('setting__plugins_import_confirm'),
    replace: t('setting__plugins_import_replace'),
    downgrade: t('setting__plugins_import_downgrade'),
    unknownVersion: t('setting__plugins_unknown_version'),
  }
  try {
    if (id) {
      const result = await ipcRenderer.invoke(PLUGIN_IPC.export, id, labels) as PluginTransferResult<{ id: PluginId, filename: string }>
      if (result.status === 'cancelled') return
      pluginTransferNotice.value = result.status === 'error'
        ? { message: t(`setting__plugins_transfer_${result.code}`), error: true }
        : { message: t('setting__plugins_export_success', { path: result.value.filename }), error: false }
    } else {
      const result = await ipcRenderer.invoke(PLUGIN_IPC.import, labels) as PluginTransferResult<{ id: PluginId, snapshot: PluginStoreSnapshot }>
      if (result.status === 'cancelled') return
      if (result.status === 'error') {
        pluginTransferNotice.value = { message: t(`setting__plugins_transfer_${result.code}`) + (result.detail ? '\n' + result.detail : ''), error: true }
        return
      }
      Reflect.deleteProperty(pluginOperationErrors, result.value.id)
      await applySnapshot(result.value.snapshot)
      const failed = !!pluginRuntime.errors[result.value.id]
      pluginTransferNotice.value = { message: t(failed ? 'setting__plugins_import_load_failed' : 'setting__plugins_import_success'), error: failed }
    }
  } catch {
    pluginTransferNotice.value = { message: t('setting__plugins_transfer_write_failed'), error: true }
  } finally { pluginTransferBusy.value = false }
}

export const initOptionalPlugins = async() => {
  const onProgress = () => {
    pluginTransferNotice.value = { message: useI18n()('setting__plugins_compiling'), error: false }
  }
  const onChange = (_event: Electron.IpcRendererEvent, snapshot: PluginStoreSnapshot) => { void applySnapshot(snapshot).catch(console.error) }
  ipcRenderer.on(PLUGIN_IPC.changed, onChange)
  ipcRenderer.on(PLUGIN_IPC.progress, onProgress)
  try { await applySnapshot(await ipcRenderer.invoke(PLUGIN_IPC.list)) } catch (error: any) { pluginStoreError.value = error.message }
  return () => {
    ipcRenderer.removeListener(PLUGIN_IPC.changed, onChange)
    ipcRenderer.removeListener(PLUGIN_IPC.progress, onProgress)
    void pluginRuntime.dispose()
  }
}
