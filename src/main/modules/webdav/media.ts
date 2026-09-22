import { app } from 'electron'
import http from 'node:http'
import https from 'node:https'
import { randomBytes, createHash } from 'node:crypto'
import { pipeline } from 'node:stream'
import type { AddressInfo, Socket } from 'node:net'
import { createClient, resolveConfig, resolveMediaURL } from './client'
import { WebDAVError } from './errors'

const config = (): LX.WebDAV.Config => ({ url: global.lx.appSetting['sync.webdav.url'], username: global.lx.appSetting['sync.webdav.username'], password: global.lx.appSetting['sync.webdav.password'], directory: '' })
const identity = (value: LX.WebDAV.Config) => createHash('sha256').update(resolveConfig(value).base.href + '\n' + value.username).digest('hex')
export const browseWebDAVAudio = async(relative: string) => {
  const value = config()
  return { ...await createClient(value).browse(relative), identity: identity(value) }
}

const entries = new Map<string, { path: string, identity: string, time: number }>()
const sockets = new Set<Socket>()
let server: http.Server | undefined
let starting: Promise<number> | undefined
const start = async(): Promise<number> => {
  if (server?.listening) return (server.address() as AddressInfo).port
  starting ??= (async() => {
    const instance = server = http.createServer((req, res) => {
      const token = (req.url ?? '').slice(1)
      const entry = entries.get(token)
      const port = (instance.address() as AddressInfo).port
      if (req.headers.host !== `127.0.0.1:${port}` || !['GET', 'HEAD'].includes(req.method ?? '') || !entry || Date.now() - entry.time > 30 * 60_000) { res.writeHead(403).end(); return }
      if (req.headers.origin && !['null', 'http://localhost:9080'].includes(req.headers.origin)) { res.writeHead(403).end(); return }
      // The player uses an anonymous cross-origin media element, including from file://.
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? 'null')
      res.setHeader('Vary', 'Origin')
      const value = config()
      try { if (entry.identity !== identity(value)) throw new Error('Account changed') } catch { res.writeHead(403).end(); return }
      entry.time = Date.now()
      const range = req.headers.range
      if (range && !/^bytes=\d*-\d*$/.test(range)) { res.writeHead(416).end(); return }
      let upstream: http.ClientRequest | undefined
      let deadline: NodeJS.Timeout | undefined
      const abort = () => { clearTimeout(deadline); upstream?.destroy() }
      res.once('close', abort)
      const send = (url: URL, redirects = 0) => {
        upstream = (url.protocol === 'https:' ? https : http).request(url, {
          method: req.method,
          headers: { Authorization: 'Basic ' + Buffer.from(value.username + ':' + value.password).toString('base64'), ...(range ? { Range: range } : {}) },
        }, response => {
          clearTimeout(deadline)
          if ([301, 302, 307, 308].includes(response.statusCode ?? 0)) {
            response.resume()
            try {
              if (redirects >= 3 || !response.headers.location) throw new Error('redirect')
              send(resolveMediaURL(value, new URL(response.headers.location, url).href), redirects + 1)
            } catch { res.writeHead(502).end() }
            return
          }
          if (![200, 206, 416].includes(response.statusCode ?? 0)) { response.destroy(); res.writeHead(response.statusCode === 401 || response.statusCode === 403 ? 403 : 502).end(); return }
          const headers: Record<string, string | number> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
          for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (typeof response.headers[key] === 'string') headers[key] = response.headers[key]
          res.writeHead(response.statusCode!, headers)
          pipeline(response, res, () => { abort() })
        })
        upstream.setTimeout(30_000, () => upstream?.destroy(new Error('WebDAV audio stalled')))
        deadline = setTimeout(() => upstream?.destroy(new Error('WebDAV audio timeout')), 30_000)
        upstream.once('error', () => { clearTimeout(deadline); if (!res.headersSent) res.writeHead(502).end(); else res.destroy() })
        upstream.end()
      }
      try { send(resolveMediaURL(value, entry.path)) } catch { res.writeHead(400).end() }
    })
    instance.maxConnections = 6; instance.headersTimeout = 5000; instance.requestTimeout = 10000
    await new Promise<void>((resolve, reject) => { instance.once('error', reject); instance.listen(0, '127.0.0.1', resolve) })
    instance.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)) })
    app.once('will-quit', () => { instance.close(); for (const socket of sockets) socket.destroy(); entries.clear() })
    return (instance.address() as AddressInfo).port
  })().finally(() => { starting = undefined })
  return starting
}

export const getWebDAVAudioURL = async(request: { path: string, identity: string }) => {
  const value = config()
  const url = resolveMediaURL(value, request.path)
  if (request.identity !== identity(value)) throw new WebDAVError('invalid_config')
  if (!/\.(mp3|flac|wav|m4a|ogg|opus|aac|webm)$/i.test(url.pathname)) throw new WebDAVError('invalid_data')
  const port = await start()
  const token = randomBytes(24).toString('base64url')
  for (const [key, entry] of entries) if (Date.now() - entry.time > 30 * 60_000 || entries.size >= 128) entries.delete(key)
  entries.set(token, { ...request, time: Date.now() })
  return `http://127.0.0.1:${port}/${token}`
}
