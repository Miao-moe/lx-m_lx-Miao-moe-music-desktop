const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const { EventEmitter, once } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

async function fixture(t) {
  const reserve = net.createServer().listen(0, '127.0.0.1'); await once(reserve, 'listening')
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve))
  const previous = global.lx; const bus = new EventEmitter(); const actions = []
  global.lx = { event_app: bus, player_status: { status: 'pause', name: 'Test', duration: 300, volume: 0.5, lyric: 'lyrics' } }
  const api = loader({ '@common/utils/nodejs': { getAddress: () => [] }, '@main/modules/winMain': { sendTaskbarButtonClick: (...args) => actions.push(args) } })('src/main/modules/openApi/server.ts')
  t.after(async() => { await api.stopServer(); global.lx = previous })
  const status = await api.startServer(port, false)
  assert.equal(status.status, true, status.message)
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: url, method: options.method ?? 'GET', headers: { Connection: 'close', ...options.headers } }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }))
    })
    req.on('error', reject); req.end(options.body)
  })
  const auth = { Authorization: 'Bearer ' + status.token }
  const subscribe = () => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/subscribe-player-status', headers: auth }, res => { res.on('error', () => {}); res.resume(); resolve({ req, res }) })
    req.on('error', reject)
  })
  return { api, port, auth, status, bus, request, subscribe, actions }
}
test('H07: loopback reads require a token; controls require authenticated POST and valid origin/host', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/status')).status, 401)
  assert.equal((await f.request('/status?token=' + f.status.token)).status, 401)
  assert.equal((await f.request('/status', { headers: f.auth })).status, 200)
  assert.equal((await f.request('/play', { headers: f.auth })).status, 405)
  assert.equal((await f.request('/play', { method: 'POST', headers: { ...f.auth, Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await f.request('/play', { method: 'POST', headers: { ...f.auth, Host: 'evil.example:' + f.port } })).status, 403)
  assert.equal((await f.request('/play', { method: 'POST', headers: f.auth })).status, 200)
  assert.deepEqual(f.actions, [['play']])
  const post = body => f.request('/seek', { method: 'POST', headers: { ...f.auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post({ offset: -1 })).status, 400)
  assert.equal((await post({ offset: 301 })).status, 400)
  assert.equal((await post({ offset: 20 })).status, 200)
  assert.deepEqual(f.actions.at(-1), ['seek', 20])
})
test('H08: subscriptions are capped per client, blocked readers are dropped, and restart removes listeners', async t => {
  const f = await fixture(t)
  const a = await f.subscribe(); const b = await f.subscribe(); const c = await f.subscribe()
  t.after(() => { for (const client of [a, b, c]) client.req.destroy() })
  assert.equal(a.res.statusCode, 200); assert.equal(b.res.statusCode, 200); assert.equal(c.res.statusCode, 429)
  const closed = new Promise(resolve => a.res.once('close', resolve))
  f.bus.emit('player_status', { name: 'x'.repeat(70 * 1024) })
  await closed
  assert.equal(f.bus.listenerCount('player_status'), 1)
  const restart = f.api.startServer(f.port, false); const stop = f.api.stopServer()
  await Promise.all([restart, stop])
  assert.equal(f.api.getStatus().status, false)
  assert.equal(f.bus.listenerCount('player_status'), 0)
  assert.equal((await f.api.startServer(f.port, false)).status, true)
  assert.notEqual(f.api.getStatus().token, f.status.token)
})
