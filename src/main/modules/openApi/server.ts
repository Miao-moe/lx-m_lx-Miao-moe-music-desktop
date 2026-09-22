import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Socket } from 'node:net'
import { getAddress } from '@common/utils/nodejs'
import { sendTaskbarButtonClick } from '@main/modules/winMain'
import { formatError } from '@common/utils/errorMessage'

export const OPEN_API_LIMITS = { connections: 32, subscriptions: 8, subscriptionsPerAddress: 2, buffer: 64 * 1024, body: 4096 }
type SubscribeKeys = keyof LX.Player.Status
const status: LX.OpenAPI.Status = { status: false, message: '', address: '', token: '' }
let httpServer: http.Server | undefined
let heartbeat: ReturnType<typeof setInterval> | undefined
const sockets = new Set<Socket>()
const responses = new Map<http.ServerResponse, { keys: SubscribeKeys[], address: string }>()
const defaults: SubscribeKeys[] = ['status', 'name', 'singer', 'albumName', 'lyricLineText', 'duration', 'progress', 'playbackRate']
const actions = { '/play': 'play', '/pause': 'pause', '/skip-next': 'next', '/skip-prev': 'prev', '/collect': 'collect', '/uncollect': 'unCollect' } as const
const reads = new Set(['/status', '/lyric', '/lyric-all', '/subscribe-player-status'])
const controls = new Set([...Object.keys(actions), '/seek', '/volume', '/mute'])
const respond = (res: http.ServerResponse, code: number, message: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(typeof message === 'string' ? { message } : message))
}
const filter = (value: string | null): SubscribeKeys[] => value ? Object.keys(global.lx.player_status).filter(key => value.split(',').includes(key)) as SubscribeKeys[] : defaults
const writeEvent = (res: http.ServerResponse, text: string) => {
  if (res.destroyed || res.writableEnded || res.writableLength + Buffer.byteLength(text) > OPEN_API_LIMITS.buffer) { responses.delete(res); res.destroy(); return }
  // A stalled reader reconnects for current state instead of growing an event queue.
  if (!res.write(text)) { responses.delete(res); res.destroy() }
}
const sendStatus = (update: Partial<LX.Player.Status>) => {
  for (const [res, { keys }] of responses) {
    const text = Object.entries(update).filter(([key]) => keys.includes(key as SubscribeKeys)).map(([key, value]) => `event: ${key}\ndata: ${JSON.stringify(value)}\n\n`).join('')
    if (text) writeEvent(res, text)
  }
}
const tokenMatches = (candidate: string, expected: string) => Buffer.byteLength(candidate) === Buffer.byteLength(expected) && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
const readBody = async(req: http.IncomingMessage) => {
  if (req.headers['content-length'] === '0' || (!req.headers['content-length'] && !req.headers['transfer-encoding'])) return {}
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw Object.assign(Error('JSON body required'), { status: 415 })
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > OPEN_API_LIMITS.body) throw Object.assign(Error('Request body too large'), { status: 413 })
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid JSON body')
  return value as Record<string, unknown>
}
const stop = async() => {
  global.lx.event_app.off('player_status', sendStatus)
  clearInterval(heartbeat)
  const server = httpServer
  httpServer = undefined
  for (const socket of sockets) socket.destroy()
  sockets.clear(); responses.clear()
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => { error ? reject(error) : resolve() }))
  Object.assign(status, { status: false, message: '', address: '', token: '' })
  return status
}
const start = async(port: number, bindLan: boolean) => {
  await stop()
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof bindLan !== 'boolean') throw Error('开放 API 端口无效')
    const token = randomBytes(32).toString('base64url')
    const addresses = ['127.0.0.1', ...(bindLan ? getAddress() : [])]
    const hosts = new Set([...addresses, 'localhost'].map(address => `${address}:${port}`))
    const server = httpServer = http.createServer((req, res) => {
      void (async() => {
        if (!hosts.has(req.headers.host ?? '')) { respond(res, 403, 'Invalid Host'); return }
        const origin = req.headers.origin
        if ((origin !== undefined && ![...hosts].some(host => origin === `http://${host}`)) || req.headers['sec-fetch-site'] === 'cross-site') { respond(res, 403, 'Origin not allowed'); return }
        if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        if (!reads.has(url.pathname) && !controls.has(url.pathname)) { respond(res, 404, 'Unknown operation'); return }
        const method = controls.has(url.pathname) ? 'POST' : 'GET'
        res.setHeader('Allow', method)
        if (req.method === 'OPTIONS' && origin) {
          res.setHeader('Access-Control-Allow-Methods', method); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.writeHead(204); res.end(); return
        }
        if (req.method !== method) { respond(res, 405, `${method} required`); return }
        const bearer = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1]
        const candidate = bearer ?? (url.pathname === '/subscribe-player-status' ? url.searchParams.get('token') ?? '' : '')
        if (!tokenMatches(candidate, token)) { respond(res, 401, 'Bearer token required'); return }
        if (url.pathname === '/subscribe-player-status') {
          const address = req.socket.remoteAddress ?? ''
          if (responses.size >= OPEN_API_LIMITS.subscriptions || [...responses.values()].filter(item => item.address === address).length >= OPEN_API_LIMITS.subscriptionsPerAddress) { respond(res, 429, 'Subscription limit reached'); return }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
          req.socket.setTimeout(0)
          const keys = filter(url.searchParams.get('filter'))
          responses.set(res, { keys, address })
          res.once('close', () => { responses.delete(res) })
          writeEvent(res, keys.map(key => `event: ${key}\ndata: ${JSON.stringify(global.lx.player_status[key])}\n\n`).join(''))
          return
        }
        if (url.pathname === '/status') { respond(res, 200, Object.fromEntries(filter(url.searchParams.get('filter')).map(key => [key, global.lx.player_status[key]]))); return }
        if (url.pathname === '/lyric') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(global.lx.player_status.lyric); return }
        if (url.pathname === '/lyric-all') { respond(res, 200, Object.fromEntries(['lyric', 'tlyric', 'rlyric', 'lxlyric'].map(key => [key, global.lx.player_status[key as SubscribeKeys]]))); return }
        const body = await readBody(req)
        if (url.pathname in actions) sendTaskbarButtonClick(actions[url.pathname as keyof typeof actions])
        else if (url.pathname === '/mute') {
          const value = body.mute ?? url.searchParams.get('mute')
          if (![true, false, 'true', 'false'].includes(value as any)) throw Error('Invalid mute value')
          sendTaskbarButtonClick('mute', value === true || value === 'true')
        } else {
          const key = url.pathname === '/seek' ? 'offset' : 'volume'
          const raw = body[key] ?? url.searchParams.get(key)
          const value = Number(raw)
          if (raw === null || raw === '' || !['string', 'number'].includes(typeof raw) || !Number.isFinite(value) || value < 0 || value > (key === 'offset' ? global.lx.player_status.duration : 100)) throw Error(`Invalid ${key}`)
          sendTaskbarButtonClick(key === 'offset' ? 'seek' : 'volume', key === 'offset' ? Math.round(value * 1000) / 1000 : value / 100)
        }
        respond(res, 200, 'OK')
      })().catch(error => { if (!res.headersSent && !res.destroyed) respond(res, error.status ?? 400, formatError(error, '开放 API 请求失败', 'OPEN_API_REQUEST_INVALID')); else res.destroy() })
    })
    server.maxConnections = OPEN_API_LIMITS.connections
    server.maxHeadersCount = 32
    server.headersTimeout = 5000
    server.requestTimeout = 10000
    server.keepAliveTimeout = 4000
    server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.setTimeout(10000, () => socket.destroy()) })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, bindLan ? '0.0.0.0' : '127.0.0.1', resolve) })
    server.on('error', error => { status.message = formatError(error, '开放 API 服务失败', 'OPEN_API_SERVER_ERROR') })
    Object.assign(status, { status: true, message: '', address: addresses.join(', '), token })
    global.lx.event_app.on('player_status', sendStatus)
    heartbeat = setInterval(() => { for (const res of responses.keys()) writeEvent(res, ': heartbeat\n\n') }, 15000)
    heartbeat.unref()
  } catch (error) { await stop(); status.message = formatError(error, '启动开放 API 失败', 'OPEN_API_START_FAILED') }
  return { ...status }
}
let lifecycle = Promise.resolve<unknown>(undefined)
const serialize = async <T>(action: () => Promise<T>): Promise<T> => {
  const result = lifecycle.then(action, action)
  lifecycle = result.catch(() => {})
  return result
}
export const startServer = async(port: number, bindLan: boolean) => serialize(async() => start(port, bindLan))
export const stopServer = async() => serialize(stop)
export const getStatus = (): LX.OpenAPI.Status => ({ ...status })
