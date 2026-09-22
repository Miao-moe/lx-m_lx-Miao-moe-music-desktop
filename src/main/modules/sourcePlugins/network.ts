import https from 'node:https'
import dns from 'node:dns'
import { isIP, BlockList } from 'node:net'
import type { SourcePluginManifest } from '@common/sourcePlugin'
import { isPluginId } from '@common/optionalPlugins'

export const sourceError = (code: string, message: string) => Object.assign(new Error(message), { code })
const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix)
for (const [address, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(address, prefix, 'ipv6')
export const publicAddress = (address: string) => {
  if (isIP(address) === 6 && !/^[23][a-f\d]{3}:/i.test(address)) return false
  return !blocked.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4')
}
export const sourceUrl = (raw: string) => {
  const url = new URL(raw)
  if (raw.length > 8192 || url.protocol !== 'https:' || url.username || url.password || isIP(url.hostname.replace(/^\[|\]$/g, '')) || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || (url.port && url.port !== '443')) throw sourceError('SOURCE_URL_DENIED', '扩展音源仅允许公共 HTTPS 地址和默认端口')
  return url
}
export const validateSourceManifest = (value: any): SourcePluginManifest => {
  if (!value || !isPluginId(value.id) || ['wy', 'tx', 'kw', 'kg', 'mg', 'bd', 'xm'].includes(value.id) || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-z\d.-]+)?$/i.test(value.version) || typeof value.url !== 'string' || typeof value.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(value.sha256) || !Array.isArray(value.allowedOrigins) || value.allowedOrigins.length > 16) throw sourceError('SOURCE_MANIFEST_INVALID', '远程音源必须指定 ID、固定版本、HTTPS 地址、SHA-256 和允许访问的站点')
  sourceUrl(value.url)
  for (const origin of value.allowedOrigins) if (typeof origin !== 'string' || sourceUrl(origin).origin !== origin) throw sourceError('SOURCE_PERMISSION_INVALID', '允许访问的站点必须是完整 HTTPS 来源，不能包含路径或通配符')
  return { id: value.id, version: value.version, url: value.url, sha256: value.sha256.toLowerCase(), allowedOrigins: [...new Set<string>(value.allowedOrigins)] }
}

export const sourceRequest = (raw: string, options: any = {}, maxBytes = 4 * 1024 * 1024) => {
  const url = sourceUrl(raw)
  const method = String(options.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST'].includes(method)) throw sourceError('SOURCE_METHOD_DENIED', '扩展音源仅允许 GET 和 POST 请求')
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (!/^[a-z\d-]{1,64}$/i.test(key) || /^(host|cookie|connection|content-length|proxy-|sec-)/i.test(key) || typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) throw sourceError('SOURCE_HEADER_DENIED', '扩展音源请求头不被允许')
    headers[key] = value
  }
  let body = options.body ?? ''
  if (typeof body !== 'string') { body = JSON.stringify(body); headers['content-type'] = 'application/json' }
  if (Buffer.byteLength(body) > 512 * 1024) throw sourceError('SOURCE_BODY_LIMIT', '扩展音源请求正文过大')
  let cancel = () => {}
  const promise = new Promise<{ statusCode: number, headers: Record<string, unknown>, body: any }>((resolve, reject) => {
    let done = false
    const request = https.request(url, {
      method,
      headers,
      agent: false,
      // Bind the connection to a checked DNS answer, avoiding a second lookup/rebind.
      lookup: ((host: string, _options: unknown, callback: (...args: any[]) => void) => {
        dns.lookup(host, { all: true, verbatim: true }, (error, addresses) => {
          if (error) { callback(error); return }
          if (!addresses.length || addresses.some(item => !publicAddress(item.address))) { callback(sourceError('SOURCE_ADDRESS_DENIED', '扩展音源不能访问本机或私有网络')); return }
          if ((_options as any)?.all) callback(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        })
      }) as any,
    })
    const finish = (error?: Error, value?: any) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (error) { reject(error); request.destroy(); return }
      resolve(value)
    }
    const timer = setTimeout(() => { finish(sourceError('SOURCE_REQUEST_TIMEOUT', '扩展音源请求超时')) }, 15_000)
    cancel = () => { finish(sourceError('SOURCE_REQUEST_CANCELLED', '扩展音源请求已取消')) }
    request.on('error', error => { finish(error) })
    request.on('response', response => {
      if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) { response.destroy(); finish(sourceError('SOURCE_REDIRECT_DENIED', '扩展音源请求不允许重定向')); return }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > maxBytes) { response.destroy(); finish(sourceError('SOURCE_RESPONSE_LIMIT', '扩展音源响应过大')); return }
        chunks.push(chunk)
      })
      response.on('aborted', () => { finish(sourceError('SOURCE_RESPONSE_INTERRUPTED', '扩展音源响应中断')) })
      response.on('error', error => { finish(error) })
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let body: unknown = text
        if (options.format === 'json' || (!options.format && String(response.headers['content-type']).includes('json'))) {
          try { body = JSON.parse(text) } catch { finish(sourceError('SOURCE_RESPONSE_INVALID', '扩展音源返回了无效 JSON')); return }
        }
        finish(undefined, { statusCode: response.statusCode, headers: response.headers, body })
      })
    })
    request.end(body)
  })
  return { promise, cancelHttp: () => { cancel() } }
}
