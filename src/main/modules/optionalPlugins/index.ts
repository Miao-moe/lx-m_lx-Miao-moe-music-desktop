import { BrowserWindow, dialog, ipcMain, net } from 'electron'
import path from 'node:path'
import { OFFICIAL_PLUGIN_ROOT, PLUGIN_CATALOG_FILE, PLUGIN_IPC, pluginText, comparePluginVersions, type PluginPackageFormat, type PluginId, type PluginStoreSnapshot, type PluginTransferLabels, type PluginTransferResult } from '@common/optionalPlugins'
import { getWebContents } from '../winMain/main'
import { PluginManager, PluginTransferError } from './manager'
import { compilePluginSource } from './compiler'
import { errorForTransport } from '@common/utils/errorMessage'
import { assertIpcRequest } from '@main/utils/ipcPolicy'

const handle = (name: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) => {
  ipcMain.handle(name, async(event, ...args) => {
    try { assertIpcRequest(event, name, args[0], args.slice(1)); return await listener(event, ...args) } catch (error) { throw errorForTransport(error) }
  })
}

let manager: PluginManager
export const getPluginManager = () => manager
export const notifyPluginBackupRestored = async() => {
  const snapshot = await manager.backupRestored()
  for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.isDestroyed()) window.webContents.send(PLUGIN_IPC.changed, snapshot)
}

export default () => {
  manager = new PluginManager(path.join(global.lxDataPath, 'plugins'), async(url, maxBytes) => {
    if (!url.startsWith(OFFICIAL_PLUGIN_ROOT)) throw new Error('Invalid official plugin URL')
    // net.request also supports the Electron 22 Windows 7 build and the app's proxy.
    return new Promise<Buffer>((resolve, reject) => {
      const request = net.request({ url, partition: 'persist:win-main', redirect: 'error' })
      if (url.endsWith('/' + PLUGIN_CATALOG_FILE)) request.setHeader('Cache-Control', 'no-cache')
      let completed = false
      const fail = (error: Error) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        reject(error)
        request.abort()
      }
      const timer = setTimeout(() => { fail(new Error('Plugin download timed out')) }, 30_000)
      request.on('error', fail)
      request.on('response', response => {
        if (response.statusCode < 200 || response.statusCode >= 300) { fail(new Error(`GitHub HTTP ${response.statusCode}`)); return }
        if (Number(response.headers['content-length']) > maxBytes) { fail(new Error('Plugin download is too large')); return }
        const chunks: Buffer[] = []
        let length = 0
        response.on('error', fail)
        response.on('aborted', () => { fail(new Error('Plugin download interrupted')) })
        response.on('data', (chunk: Buffer) => {
          if (completed) return
          length += chunk.length
          if (length > maxBytes) { fail(new Error('Plugin download is too large')); return }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (completed) return
          completed = true
          clearTimeout(timer)
          resolve(Buffer.concat(chunks))
        })
      })
      request.end()
    })
  }, {
    compileSource: compilePluginSource,
    onCompile: id => {
      const contents = getWebContents()
      if (!contents.isDestroyed()) contents.send(PLUGIN_IPC.progress, { phase: 'compiling', id })
    },
  })
  const broadcast = (snapshot: PluginStoreSnapshot) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send(PLUGIN_IPC.changed, snapshot)
    }
    return snapshot
  }
  handle(PLUGIN_IPC.list, async() => manager.snapshot())
  handle(PLUGIN_IPC.refresh, async() => broadcast(await manager.refresh()))
  handle(PLUGIN_IPC.install, async(_event, id: PluginId, format?: PluginPackageFormat) => broadcast(await manager.install(id, format)))
  handle(PLUGIN_IPC.uninstall, async(_event, id: PluginId) => broadcast(await manager.uninstall(id)))
  handle(PLUGIN_IPC.setEnabled, async(event, id: PluginId, enabled: boolean) => {
    if (event.sender !== getWebContents() || event.senderFrame !== event.sender.mainFrame) throw new Error('Plugin state changes require the main window')
    return broadcast(await manager.setEnabled(id, enabled))
  })
  handle(PLUGIN_IPC.runtimeResult, async(event, id: PluginId, directory: string, error?: string) => {
    const lyric = event.sender !== getWebContents()
    if (event.senderFrame !== event.sender.mainFrame || (lyric && !new URL(event.sender.getURL()).pathname.endsWith('/lyric.html'))) throw new Error('Invalid plugin runtime window')
    return broadcast(await manager.reportRuntimeResult(id, directory, error, lyric))
  })

  const transferState = { busy: false }
  const transfer = async<T>(event: Electron.IpcMainInvokeEvent, labels: PluginTransferLabels, operation: (window: BrowserWindow) => Promise<PluginTransferResult<T>>): Promise<PluginTransferResult<T>> => {
    if (transferState.busy) return { status: 'error', code: 'busy' }
    if (event.sender !== getWebContents() || event.senderFrame !== event.sender.mainFrame) throw new Error('Plugin transfer requires the main window')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return { status: 'cancelled' }
    for (const key of ['title', 'filter', 'confirm', 'cancel', 'trust', 'install', 'replace', 'downgrade', 'unknownVersion'] as const) {
      if (!labels || typeof labels[key] !== 'string' || labels[key].length > 2000) throw new Error('Invalid plugin dialog options')
    }
    transferState.busy = true
    try { return await operation(window) } catch (error) {
      console.error('Plugin transfer failed:', error)
      return { status: 'error', code: error instanceof PluginTransferError ? error.code : 'write_failed', detail: errorForTransport(error).message }
    } finally { transferState.busy = false }
  }
  handle(PLUGIN_IPC.import, async(event, labels: PluginTransferLabels) => transfer(event, labels, async window => {
    const selected = await dialog.showOpenDialog(window, {
      title: labels.title,
      filters: [{ name: labels.filter, extensions: ['lxplugin', 'zip'] }],
      properties: ['openFile'],
    })
    if (selected.canceled || !selected.filePaths.length || window.isDestroyed()) return { status: 'cancelled' }
    const prepared = await manager.prepareImport(selected.filePaths[0])
    const manifest = prepared.manifest
    const downgrade = prepared.previousVersion && comparePluginVersions(manifest.version, prepared.previousVersion) < 0
    const template = !prepared.replacing ? labels.install : downgrade ? labels.downgrade : labels.replace
    const values: Record<string, string> = {
      name: pluginText(manifest.name, global.lx.appSetting['common.langId'] ?? 'zh-cn', manifest.id),
      version: manifest.version,
      previous: prepared.previousVersion ?? labels.unknownVersion,
    }
    const confirmed = await dialog.showMessageBox(window, {
      type: 'question',
      title: labels.title,
      message: template.replace(/\{(name|version|previous)\}/g, (_, key: string) => values[key]),
      detail: `ID: ${manifest.id}\n\n${labels.trust}`,
      buttons: [labels.confirm, labels.cancel],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (confirmed.response !== 0 || window.isDestroyed()) return { status: 'cancelled' }
    return { status: 'success', value: { id: manifest.id, snapshot: broadcast(await manager.importPrepared(prepared)) } }
  }))
  handle(PLUGIN_IPC.export, async(event, id: PluginId, labels: PluginTransferLabels) => transfer(event, labels, async window => {
    const archive = await manager.createExport(id)
    const selected = await dialog.showSaveDialog(window, {
      title: labels.title,
      defaultPath: `${archive.manifest.id}-${archive.manifest.version}.${archive.format}`,
      filters: [{ name: labels.filter, extensions: [archive.format] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (selected.canceled || !selected.filePath || window.isDestroyed()) return { status: 'cancelled' }
    const filename = path.extname(selected.filePath) ? selected.filePath : selected.filePath + '.' + archive.format
    return { status: 'success', value: { id, filename: await manager.writeExport(filename, archive.bytes, archive.format) } }
  }))
}
