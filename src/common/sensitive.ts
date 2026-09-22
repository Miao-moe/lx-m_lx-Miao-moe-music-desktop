export const credentialKeys = new Set(['cookie.wy', 'cookie.tx', 'cookie.kg', 'cookie.kw', 'cookie.mg', 'sync.webdav.url', 'sync.webdav.username', 'sync.webdav.password'])
const sensitiveKey = /(?:cookie|authorization|password|passwd|secret|token|authcode|api[-_]?key|credential)/i
const hidden = '[REDACTED]'

export const redactText = (value: string) => value
  .replace(/https?:\/\/[^\s"'<>]+/gi, raw => {
    try { const url = new URL(raw); url.username = ''; url.password = ''; if (url.search) url.search = '?redacted'; url.hash = ''; return url.href } catch { return '[URL]' }
  })
  .replace(/((?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, '$1' + hidden)
  .replace(/((?:password|passwd|secret|token|authcode|api[-_]?key)\s*["']?\s*[:=]\s*)["']?[^\s,;"'}]+/gi, '$1' + hidden)
  .replace(/(["']?[\w.-]*(?:cookie|authorization|password|passwd|secret|token|authcode|api[-_]?key|webdav\.url|webdav\.username)[\w.-]*["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\r\n]+)/gi, '$1' + hidden)

export const redactSensitive = (value: unknown, seen = new WeakSet<object>(), depth = 0): unknown => {
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  if (depth > 12) return '[Object]'
  seen.add(value)
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), stack: redactText(value.stack ?? ''), ...redactSensitive({ ...value }, seen, depth + 1) as object }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[Binary]'
  if (Array.isArray(value)) return value.slice(0, 1000).map(item => redactSensitive(item, seen, depth + 1))
  return Object.fromEntries(Object.entries(value).slice(0, 1000).map(([key, item]) => [key, sensitiveKey.test(key) || credentialKeys.has(key) ? hidden : redactSensitive(item, seen, depth + 1)]))
}

export const redactArguments = (args: unknown[]) => args.map((item, index) => index > 0 && typeof args[index - 1] === 'string' && sensitiveKey.test(args[index - 1] as string) && typeof item === 'string' ? hidden : redactSensitive(item))
let installed = false
export const installConsoleRedaction = () => {
  if (installed) return
  installed = true
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[name].bind(console)
    console[name] = (...args: unknown[]) => { original(...redactArguments(args)) }
  }
}

export const publicSettings = <T extends Record<string, any>>(settings: T): T => Object.fromEntries(Object.entries(settings).filter(([key]) => !credentialKeys.has(key))) as T
