const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const http = require('node:http')
const loader = require('./helpers/load-typescript.cjs')
const { createDAV } = require('./helpers/webdav-fixture.cjs')

async function fixture(t, quickTimeout = false) {
  const dav = await createDAV(), app = new EventEmitter(), before = global.lx
  global.lx = { appSetting: Object.fromEntries(Object.entries(dav.config).map(([key, value]) => ['sync.webdav.' + key, value])) }
  const load = loader({ electron: { app }, 'node:http': quickTimeout ? { ...http, request: (...args) => {
    const req = http.request(...args), original = req.setTimeout.bind(req)
    req.setTimeout = (_, listener) => original(100, listener)
    return req
  } } : http })
  const media = load('src/main/modules/webdav/media.ts')
  t.after(async() => { app.emit('will-quit'); await dav.close(); global.lx = before })
  const directory = await media.browseWebDAVAudio('')
  return { dav, media, load, identity: directory.identity }
}

test('F12: authenticated audio streams ranges and rejects wrong tokens, methods and escaped roots', async t => {
  const { dav, media, identity, load } = await fixture(t)
  const bytes = Buffer.from('0123456789abcdef')
  dav.control.beforeRequest = (req, res) => {
    if (!req.url.endsWith('.wav')) return
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Number(range[2]) : bytes.length - 1
    res.writeHead(range ? 206 : 200, { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) })
    res.end(req.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1)); return true
  }
  const url = await media.getWebDAVAudioURL({ path: 'music.wav', identity })
  assert.equal(new URL(url).hostname, '127.0.0.1')
  assert(!url.includes('fixture')); assert(!url.includes('word'))
  const response = await fetch(url, { headers: { Range: 'bytes=4-9', Origin: 'null' } })
  assert.equal(response.headers.get('access-control-allow-origin'), 'null')
  assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 4-9/16')
  assert.equal(await response.text(), '456789')
  assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-length'), '16')
  assert.equal((await fetch(url + 'bad')).status, 403)
  assert.equal((await fetch(url, { headers: { Origin: 'https://example.com' } })).status, 403)
  assert.equal((await fetch(url, { method: 'POST' })).status, 403)
  assert.equal((await fetch(url, { headers: { Range: 'bytes=1-2,3-4' } })).status, 416)
  const resolve = load('src/main/modules/webdav/client.ts').resolveMediaURL
  for (const path of ['../outside.wav', 'https://example.com/music.wav', '%2fescape.wav', 'x%5cy.wav', 'a%00.wav', 'song.wav?token=bad']) assert.throws(() => resolve(dav.config, path), /invalid_config/)
  global.lx.appSetting['sync.webdav.username'] = 'another account'
  assert.equal((await fetch(url)).status, 403)
  await assert.rejects(media.getWebDAVAudioURL({ path: 'music.wav', identity }), /invalid_config/)
})

test('F12: redirect cannot forward credentials outside the configured root or to another origin', async t => {
  const { dav, media, identity } = await fixture(t)
  let target = 'https://example.com/stolen.wav'
  dav.control.beforeRequest = (req, res) => { res.writeHead(302, { Location: target }).end(); return true }
  const url = await media.getWebDAVAudioURL({ path: 'redirect.wav', identity })
  assert.equal((await fetch(url)).status, 502)
  target = new URL('/outside.wav', dav.config.url).href
  assert.equal((await fetch(url)).status, 502)
  assert(dav.requests.every(req => !req.path.includes('outside')))
})

test('F12: stalled audio bodies terminate and closing the player aborts the upstream stream', async t => {
  const { dav, media, identity } = await fixture(t, true)
  dav.control.beforeRequest = (req, res) => { res.writeHead(200, { 'Content-Length': '1000000', 'Content-Type': 'audio/wav' }); res.write('first'); return true }
  const url = await media.getWebDAVAudioURL({ path: 'stalled.wav', identity })
  const response = await fetch(url)
  await assert.rejects(response.arrayBuffer(), /terminated|aborted/i)
  let closed
  const upstreamClosed = new Promise(resolve => { closed = resolve })
  dav.control.beforeRequest = (req, res) => { res.on('close', closed); res.writeHead(200, { 'Content-Length': '1000000' }); res.write('first'); return true }
  const controller = new AbortController()
  const pending = await fetch(url, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending.arrayBuffer())
  await upstreamClosed
})
