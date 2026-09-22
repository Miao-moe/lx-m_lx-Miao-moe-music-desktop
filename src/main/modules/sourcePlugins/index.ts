import { BrowserWindow, ipcMain, session } from 'electron'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { mainHandle, mainOn } from '@common/mainIpc'
import { SOURCE_PLUGIN_IPC as channels, type SourcePluginManifest } from '@common/sourcePlugin'
import { errorForTransport, getErrorInfo } from '@common/utils/errorMessage'
import { validateIpcValue } from '@main/utils/ipcPolicy'
import { sourceError, sourceRequest, sourceUrl, validateSourceManifest } from './network'
import { sandboxRuntime } from './runtime'

interface Runtime {
  manifest: SourcePluginManifest
  owner: Electron.WebContents
  window: Electron.BrowserWindow
  methods: Set<string>
  pending: Map<string, { resolve: (value: any) => void, reject: (error: Error) => void, timer: NodeJS.Timeout, cancelled?: boolean }>
  network: Map<string, () => void>
}
const runtimes = new Map<string, Runtime>()
const windows = new WeakMap<Electron.WebContents, Runtime>()
const disposed = new WeakSet<Runtime>()
const initialUrl = 'data:text/html;charset=UTF-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'; frame-src \'none\'; worker-src \'none\'; form-action \'none\'; base-uri \'none\'"><title>Source sandbox</title>')
const destroy = (runtime: Runtime, error = sourceError('SOURCE_RUNTIME_CLOSED', '扩展音源运行环境已关闭')) => {
  if (disposed.has(runtime)) return
  disposed.add(runtime)
  if (runtimes.get(runtime.manifest.id) === runtime) runtimes.delete(runtime.manifest.id)
  if (!runtime.window.isDestroyed()) windows.delete(runtime.window.webContents)
  for (const task of runtime.pending.values()) { clearTimeout(task.timer); task.reject(error) }
  runtime.pending.clear()
  for (const cancel of runtime.network.values()) cancel()
  runtime.network.clear()
  if (!runtime.window.isDestroyed()) runtime.window.destroy()
}
const fromSandbox = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
  const runtime = windows.get(event.sender)
  if (!runtime || event.senderFrame !== event.sender.mainFrame || event.senderFrame?.url !== initialUrl) throw sourceError('SOURCE_SENDER_DENIED', '扩展音源窗口身份无效')
  return runtime
}
const methodPaths = (value: any, prefix = '', result = new Set<string>()) => {
  for (const [key, val] of Object.entries(value ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z\d_]*$/.test(key) || ['constructor', 'prototype'].includes(key)) throw sourceError('SOURCE_INTERFACE_INVALID', '扩展音源接口名称无效')
    const name = prefix ? `${prefix}.${key}` : key
    if (val && typeof val === 'object') {
      if ((val as any).$method === true) result.add(name)
      else if (!Array.isArray(val)) methodPaths(val, name, result)
    }
  }
  return result
}
let loading = 0
const load = async(owner: Electron.WebContents, input: unknown) => {
  const manifest = validateSourceManifest(input)
  if (loading + runtimes.size - (runtimes.has(manifest.id) ? 1 : 0) >= 4) throw sourceError('SOURCE_RUNTIME_LIMIT', '最多同时加载 4 个远程音源')
  loading++
  let runtime: Runtime | undefined
  const request = sourceRequest(manifest.url, { format: 'text' }, 512 * 1024)
  const cancelled = () => { request.cancelHttp() }
  owner.once('destroyed', cancelled)
  try {
    const response = await request.promise
    if (response.statusCode !== 200 || typeof response.body !== 'string') throw sourceError('SOURCE_DOWNLOAD_FAILED', '远程音源下载失败')
    if (createHash('sha256').update(response.body).digest('hex') !== manifest.sha256) throw sourceError('SOURCE_DIGEST_MISMATCH', '远程音源内容与固定版本摘要不匹配')
    if (owner.isDestroyed()) throw sourceError('SOURCE_OWNER_CLOSED', '音源所属窗口已关闭')
    const partition = session.fromPartition('source-plugin-' + randomUUID())
    partition.setPermissionRequestHandler((_contents, _permission, reply) => { reply(false) })
    partition.setPermissionCheckHandler(() => false)
    partition.webRequest.onBeforeRequest((details, reply) => { reply({ cancel: details.resourceType !== 'mainFrame' || details.url !== initialUrl }) })
    const window = new BrowserWindow({ show: false, webPreferences: { session: partition, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false, disableDialogs: true, preload: path.join(__dirname, 'source-plugin-preload.js') } })
    runtime = { manifest, owner, window, methods: new Set(), pending: new Map(), network: new Map() }
    const current = runtime
    const previous = runtimes.get(manifest.id)
    if (previous) destroy(previous)
    runtimes.set(manifest.id, current)
    windows.set(window.webContents, current)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => { event.preventDefault() })
    window.webContents.on('will-redirect', event => { event.preventDefault() })
    window.webContents.on('will-attach-webview', event => { event.preventDefault() })
    const close = () => { destroy(current) }
    const navigate = (_event: Electron.Event, _url: string, sameDocument: boolean, mainFrame: boolean) => { if (mainFrame && !sameDocument) close() }
    owner.once('destroyed', close)
    owner.once('render-process-gone', close)
    owner.on('did-start-navigation', navigate)
    window.once('closed', () => { owner.removeListener('destroyed', close); owner.removeListener('render-process-gone', close); owner.removeListener('did-start-navigation', navigate); destroy(current) })
    window.webContents.once('render-process-gone', close)
    let timer: NodeJS.Timeout | undefined
    try {
      const descriptor = await Promise.race([
        window.loadURL(initialUrl).then(async() => window.webContents.executeJavaScript(`(${sandboxRuntime.toString()})(${JSON.stringify(response.body)})`)),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(sourceError('SOURCE_INIT_TIMEOUT', '远程音源初始化超时')) }, 10_000) }),
      ])
      validateIpcValue(descriptor)
      if (!descriptor || descriptor.id !== manifest.id || typeof descriptor.name !== 'string' || descriptor.name.length > 100) throw sourceError('SOURCE_INTERFACE_INVALID', '远程音源信息与声明不一致')
      current.methods = methodPaths(descriptor)
      return descriptor
    } finally { clearTimeout(timer) }
  } catch (error) { if (runtime) destroy(runtime); throw error } finally { loading--; owner.removeListener('destroyed', cancelled) }
}

export default () => {
  mainHandle<unknown, unknown>(channels.load, async({ event, params }) => load(event.sender, params))
  mainHandle<{ id: string, callId: string, method: string, args: unknown[] }, unknown>(channels.call, async({ event, params }) => {
    const runtime = runtimes.get(params.id)
    if (!runtime || runtime.owner !== event.sender || !runtime.methods.has(params.method)) throw sourceError('SOURCE_METHOD_INVALID', '扩展音源方法不存在')
    if (runtime.pending.size >= 8 || runtime.pending.has(params.callId)) throw sourceError('SOURCE_CALL_LIMIT', '扩展音源并发请求过多')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { destroy(runtime, sourceError('SOURCE_CALL_TIMEOUT', '远程音源执行超时，运行环境已关闭')) }, 20_000)
      runtime.pending.set(params.callId, { resolve, reject, timer })
      runtime.window.webContents.send(channels.command, { id: params.callId, method: params.method, args: params.args })
    })
  })
  mainOn<{ id: string, callId: string }>(channels.cancel, ({ event, params }) => {
    const runtime = runtimes.get(params.id)
    if (!runtime || runtime.owner !== event.sender) return
    const task = runtime.pending.get(params.callId)
    if (!task || task.cancelled) return
    task.cancelled = true
    task.reject(sourceError('SOURCE_CALL_CANCELLED', '扩展音源调用已取消'))
    // Keep the execution deadline until the sandbox acknowledges cancellation.
    // An infinite loop cannot process the message and must still be terminated.
    runtime.window.webContents.send(channels.command, { id: params.callId, cancel: true })
  })
  ipcMain.on(channels.reply, (event, packet) => {
    try {
      const runtime = fromSandbox(event)
      validateIpcValue(packet)
      if (!packet || typeof packet.id !== 'string') return
      const task = runtime.pending.get(packet.id)
      if (!task) return
      clearTimeout(task.timer)
      runtime.pending.delete(packet.id)
      if (packet.error) { const detail = getErrorInfo(String(packet.error).slice(0, 2000), 'SOURCE_CALL_FAILED'); task.reject(sourceError(detail.code, detail.reason)) } else task.resolve(packet.value)
    } catch (error) { console.warn('Source reply rejected:', error) }
  })
  ipcMain.handle(channels.network, async(event, packet) => {
    try {
      const runtime = fromSandbox(event)
      validateIpcValue(packet)
      if (!packet || typeof packet.id !== 'string' || packet.id.length > 100 || typeof packet.url !== 'string' || !runtime.manifest.allowedOrigins.includes(sourceUrl(packet.url).origin)) throw sourceError('SOURCE_ORIGIN_DENIED', '扩展音源没有访问此站点的权限')
      if (runtime.network.size >= 4 || runtime.network.has(packet.id)) throw sourceError('SOURCE_NETWORK_LIMIT', '扩展音源网络请求过多')
      const request = sourceRequest(packet.url, packet.options)
      runtime.network.set(packet.id, request.cancelHttp)
      try { return await request.promise } finally { runtime.network.delete(packet.id) }
    } catch (error) { throw errorForTransport(error) }
  })
  ipcMain.on(channels.cancelNetwork, (event, id) => {
    try { const runtime = fromSandbox(event); if (typeof id === 'string') runtime.network.get(id)?.() } catch (error) { console.warn('Source cancellation rejected:', error) }
  })
}
