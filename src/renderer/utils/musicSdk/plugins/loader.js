import { showLoadError } from '@common/loadErrorNotice'
import { rendererInvoke, rendererSend } from '@common/rendererIpc'
import { SOURCE_PLUGIN_IPC as channels } from '@common/sourcePlugin'
import { httpFetch } from '../../request'
import cryptojs from 'crypto-js'
import { getRequestSignal } from '../../requestContext'

// Local factories are bundled, trusted application code. Remote code only runs in
// an isolated Chromium sandbox, with pinned content and an explicit origin list.
const buildPluginEnv = () => ({
  httpFetch,
  crypto: { md5: value => cryptojs.MD5(value).toString() },
  utils: { formatPlayTime: sec => `${Math.floor((Number(sec) || 0) / 60).toString().padStart(2, '0')}:${Math.floor((Number(sec) || 0) % 60).toString().padStart(2, '0')}` },
})
const getPluginConfig = () => {
  const config = (typeof window !== 'undefined' && window.__lxExtSourcePlugins__) || {}
  return { locals: Array.isArray(config.locals) ? config.locals : [], remotes: Array.isArray(config.remotes) ? config.remotes : [] }
}
export const loadLocalSourcePlugins = () => {
  const results = []
  for (const item of getPluginConfig().locals) {
    const factory = typeof item === 'function' ? item : item?.default
    if (typeof factory !== 'function') continue
    try {
      const source = factory(buildPluginEnv())
      if (source?.id && source?.name) results.push({ id: source.id, name: source.name, source })
    } catch (error) { showLoadError(error, 'SOURCE_PLUGIN_LOAD_FAILED') }
  }
  return results
}
let sequence = 0
const requestMethods = new Set(['getMusicUrl', 'getLyric', 'getPic'])
const proxySource = (id, descriptor, prefix = '') => Object.fromEntries(Object.entries(descriptor).map(([key, value]) => {
  const method = prefix ? `${prefix}.${key}` : key
  if (value?.$method === true) {
    return [key, (...args) => {
      const callId = `${Date.now()}-${++sequence}`
      const signal = getRequestSignal()
      const cancelHttp = () => rendererSend(channels.cancel, { id, callId })
      const pending = signal?.aborted ? Promise.reject(signal.reason) : rendererInvoke(channels.call, { id, callId, method, args })
      signal?.addEventListener('abort', cancelHttp, { once: true })
      const promise = pending.finally(() => signal?.removeEventListener('abort', cancelHttp))
      return requestMethods.has(method) ? { promise, cancelHttp } : promise
    }]
  }
  return [key, value && typeof value === 'object' && !Array.isArray(value) ? proxySource(id, value, method) : value]
}))
export const loadRemoteSourcePlugins = async() => {
  const results = []
  // Limit initial downloads and initialization work as well as runtime concurrency.
  for (const manifest of getPluginConfig().remotes) {
    try {
      const descriptor = await rendererInvoke(channels.load, manifest)
      const source = proxySource(descriptor.id, descriptor)
      results.push({ id: source.id, name: source.name, source })
    } catch (error) { showLoadError(error, 'SOURCE_PLUGIN_LOAD_FAILED') }
  }
  return results
}
