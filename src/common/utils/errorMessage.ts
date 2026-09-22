/* eslint-disable no-control-regex -- Remove terminal and control characters from untrusted diagnostics. */
export interface ErrorInfo { code: string, reason: string }
export const errorText = (key: string, fallback: string) => {
  const i18n = (globalThis as { window?: { i18n?: { t: (key: string) => string } } }).window?.i18n
  if (i18n) {
    const value = i18n.t(key)
    if (value && value !== key) return value
  }
  return fallback
}
const clean = (value: unknown): string => String(value ?? '')
  .replace(/\x1b\[[0-9;]*m/g, '')
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
  .replace(/https?:\/\/[^\s<>"']+/gi, value => {
    try { const url = new URL(value); return url.origin + url.pathname } catch { return '[URL]' }
  })
  .replace(/\b(authorization|cookie|password|passwd|token|access_token|refresh_token|api[_-]?key)\s*[:=]\s*[^\n,;]+/gi, '$1=[redacted]')
  .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
  .split(/\n\s*at\s/)[0].trim().slice(0, 1200)
const validCode = (value: unknown) => (typeof value === 'string' || typeof value === 'number') && /^[A-Za-z0-9_.-]{1,80}$/.test(String(value))
const reasons: Record<string, [string, string]> = {
  ETIMEDOUT: ['timeout', '请求超时，服务器未在限定时间内完成响应。'],
  ESOCKETTIMEDOUT: ['timeout', '请求超时，服务器未在限定时间内完成响应。'],
  ECONNRESET: ['connection_reset', '连接被服务器或网络中断。'],
  ECONNREFUSED: ['connection_refused', '服务器拒绝连接。'],
  ENOTFOUND: ['dns', '无法解析服务器地址。'],
  EAI_AGAIN: ['dns', '无法解析服务器地址。'],
  ENETUNREACH: ['offline', '网络不可达，请检查网络连接。'],
  EHOSTUNREACH: ['offline', '网络不可达，请检查网络连接。'],
  ENOENT: ['missing_file', '文件不存在或已经被移动。'],
  EACCES: ['permission', '没有访问文件或资源的权限。'],
  EPERM: ['permission', '没有访问文件或资源的权限。'],
  ENOSPC: ['disk_full', '磁盘空间不足。'],
  EBUSY: ['file_busy', '文件正在被其他程序使用。'],
  MODULE_NOT_FOUND: ['missing_module', '插件或程序依赖文件缺失。'],
  HTTP_401: ['authentication', '身份验证失败，请检查登录状态。'],
  HTTP_403: ['forbidden', '服务器拒绝访问此资源。'],
  HTTP_404: ['not_found', '服务器上没有找到此资源。'],
  HTTP_408: ['timeout', '请求超时，服务器未在限定时间内完成响应。'],
  HTTP_429: ['rate_limit', '请求过于频繁，请稍后重试。'],
  MEDIA_1: ['media_aborted', '音频加载被中止。'],
  MEDIA_2: ['media_network', '加载音频时发生网络错误。'],
  MEDIA_3: ['media_decode', '音频损坏或无法解码。'],
  MEDIA_4: ['media_format', '音频地址无效或格式不受支持。'],
}

// Keep this usable in renderers, the main process and workers. IPC often retains
// only Error.message, so recognize codes carried in a readable [CODE] prefix.
export const getErrorInfo = (error: unknown, fallbackCode = 'LOAD_FAILED'): ErrorInfo => {
  let value: any = error
  const seen = new Set()
  let code = ''
  let message = ''
  for (let depth = 0; value != null && depth < 6 && !seen.has(value); depth++) {
    seen.add(value)
    const text = clean(typeof value === 'string' ? value : value.message ?? value.reason ?? '')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/, '')
    if (text) message = text
    const prefixed = /^\[([A-Za-z0-9_.-]{1,80})\]\s*/.exec(text)
    const backup = /\bbackup:([a-z_]+)/.exec(text)
    const system = /\b(E[A-Z_]{3,}|SQLITE_[A-Z_]+|MODULE_NOT_FOUND)\b/.exec(text)
    const status = value.statusCode ?? value.status ?? /\bHTTP[ :]*(\d{3})\b/i.exec(text)?.[1]
    const rawCode = value.code ?? value.searchDetails?.reqCode
    if (validCode(rawCode)) code = String(rawCode)
    else if (prefixed) code = prefixed[1]
    else if (backup) code = 'BACKUP_' + backup[1].toUpperCase()
    else if (system) code = system[1]
    else if (Number(status) >= 400 && Number(status) <= 599) code = 'HTTP_' + String(status)
    else if (value.name === 'SyntaxError') code ||= 'INVALID_DATA'
    else if (value.name === 'AbortError') code ||= 'ABORT_ERR'
    value = value.cause
  }
  code ||= fallbackCode
  if (code === 'LOAD_FAILED') code = fallbackCode
  message = message.replace(/^(?:\[[A-Za-z0-9_.-]{1,80}\]\s*)+/, '')
  const known = reasons[code] ?? (/^HTTP_5\d\d$/.test(code) ? ['server', '服务器发生错误，请稍后重试。'] : undefined)
  const reason = known ? errorText('error__' + known[0], known[1]) : ''
  return { code, reason: reason ? reason + (message && message !== code && message !== reason ? ' ' + message : '') : message || errorText('error__unknown', '未返回具体原因，请重试；若仍失败，请提供错误代码。') }
}
export const formatError = (error: unknown, context = '', fallbackCode = 'LOAD_FAILED') => {
  const { code, reason } = getErrorInfo(error, fallbackCode)
  return `${context ? context + '\n' : ''}${errorText('error__code', '错误代码')}：${code}\n${errorText('error__reason', '原因')}：${reason}`
}
export const isCancelledError = (error: any) => error?.name === 'AbortError' || ['ABORT_ERR', 'ERR_CANCELED', 'ERR_CANCELLED'].includes(error?.code) || /^(?:cancelRequest|取消(?:http)?请求|The operation was aborted|Request cancelled|request canceled|source changed)\.?$/i.test(error?.message ?? '')
export const errorForTransport = (error: unknown) => {
  const { code } = getErrorInfo(error)
  const value = error as { message?: string, cause?: { message?: string } } | null
  const message = clean(value?.cause?.message ?? value?.message ?? (typeof error === 'string' ? error : ''))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/, '').replace(/^(?:\[[A-Za-z0-9_.-]{1,80}\]\s*)+/, '')
  return new Error(`[${code}] ${message}`)
}
export const restoreTransportError = (error: any) => {
  const text = String(error?.message ?? '').replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/, '')
  const match = /^\[([A-Za-z0-9_.-]{1,80})\]\s*([\s\S]*)/.exec(text)
  if (match && error && typeof error === 'object') { error.code = match[1]; error.message = match[2] }
  return error
}
