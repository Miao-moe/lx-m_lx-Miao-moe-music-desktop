// This function is serialized into a separate Chromium sandbox. It has no Node access.
export function sandboxRuntime(code: string) {
  const bridge = (window as any).sourceBridge
  const module = { exports: {} as any }
  const requests = new Map<string, any>()
  let sequence = 0
  const env = {
    httpFetch: (url: string, options?: unknown) => {
      const id = String(++sequence)
      return { promise: bridge.request({ id, url, options }), cancelHttp: () => bridge.cancel(id) }
    },
    crypto: { md5: bridge.md5 },
    utils: { formatPlayTime: (sec: number) => `${Math.floor((Number(sec) || 0) / 60).toString().padStart(2, '0')}:${Math.floor((Number(sec) || 0) % 60).toString().padStart(2, '0')}` },
  }
  // The process sandbox, context isolation, CSP and the broker are the boundary.
  // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
  new Function('module', 'exports', code)(module, module.exports)
  const factory = typeof module.exports === 'function' ? module.exports : module.exports.default
  if (typeof factory !== 'function') throw new Error('SOURCE_FACTORY_INVALID: 音源必须导出工厂函数')
  const source = factory(env)
  const describe = (value: any, depth = 0): any => {
    if (depth > 5) throw new Error('SOURCE_INTERFACE_INVALID: 音源接口嵌套过深')
    if (typeof value === 'function') return { $method: true }
    if (value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => describe(item, depth + 1))
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, describe(val, depth + 1)]))
  }
  bridge.listen(async(packet: any) => {
    if (packet.cancel) {
      try { requests.get(packet.id)?.cancelHttp?.() } finally {
        requests.delete(packet.id)
        bridge.reply({ id: packet.id, error: 'SOURCE_CALL_CANCELLED: 扩展音源调用已取消' })
      }
      return
    }
    try {
      let target = source
      const parts = packet.method.split('.')
      for (const part of parts.slice(0, -1)) target = target[part]
      const request = target[parts[parts.length - 1]](...packet.args)
      requests.set(packet.id, request)
      const value = await (request?.promise ?? request)
      bridge.reply({ id: packet.id, value })
    } catch (error: any) { bridge.reply({ id: packet.id, error: String(error?.message ?? error).slice(0, 2000) }) } finally { requests.delete(packet.id) }
  })
  return describe(source)
}
