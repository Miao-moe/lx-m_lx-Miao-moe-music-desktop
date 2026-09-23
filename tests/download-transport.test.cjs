const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')(Object.fromEntries(['fs', 'path', 'events', 'perf_hooks', 'http', 'https', 'url', 'tunnel'].map(name => [name, require(name)])))
const Downloader = load('src/common/utils/download/Downloader.ts').default
const bytes = Buffer.from('A complete audio download: 0123456789 abcdefghijklmnopqrstuvwxyz')

async function fixture(t, respond) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-download-transport-'))
  const requests = []
  const server = http.createServer((req, res) => { requests.push({ url: req.url, range: req.headers.range, method: req.method }); respond(req, res) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const tasks = []
  t.after(async() => {
    for (const task of tasks) await task.stop()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-download-transport-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const start = (pathname, filename = 'audio.mp3', options = {}) => {
    const task = new Downloader(url + pathname, directory, filename, { timeout: 2000, ...options })
    const progress = []
    task.statsEstimate.time = -2000
    task.on('progress', event => progress.push(event))
    tasks.push(task)
    const completed = new Promise((resolve, reject) => {
      task.on('error', reject)
      task.on('fail', res => reject(new Error(`HTTP ${res.statusCode}`)))
      task.once('completed', resolve)
      task.start().catch(reject)
    })
    return { task, progress, completed, filename: path.join(directory, filename) }
  }
  return { directory, requests, start }
}

for (const status of [301, 302, 303, 307, 308]) {
  test(`HTTP ${status} follows a relative Location and writes the complete file`, { timeout: 5000 }, async t => {
    const f = await fixture(t, (req, res) => {
      if (req.url === '/folder/start') res.writeHead(status, { Location: '../audio?redirected=1' }).end()
      else { assert.equal(req.url, '/audio?redirected=1'); res.end(bytes) }
    })
    const dl = f.start('/folder/start')
    await dl.completed
    assert.deepEqual(await fs.readFile(dl.filename), bytes)
    assert.equal(f.requests.length, 2)
  })
}

test('mixed redirect chains work and redirect loops are bounded', { timeout: 5000 }, async t => {
  const f = await fixture(t, (req, res) => {
    const step = Number(req.url.slice(1))
    if (req.url === '/loop') res.writeHead(307, { Location: '/loop' }).end()
    else if (step < 5) res.writeHead([301, 302, 303, 307, 308][step], { Location: `/${step + 1}` }).end()
    else res.end(bytes)
  })
  const dl = f.start('/0')
  await dl.completed
  assert.deepEqual(await fs.readFile(dl.filename), bytes)
  await assert.rejects(f.start('/loop', 'loop.mp3').completed, /HTTP 307/)
  assert.equal(f.requests.filter(request => request.url === '/loop').length, 11)
})

test('chunked downloads report bytes without a total and finish only after EOF', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => {
    res.write(bytes.subarray(0, 12))
    setTimeout(() => res.end(bytes.subarray(12)), 20)
  })
  const dl = f.start('/audio')
  await dl.completed
  assert(dl.progress.some(event => event.total === 0 && event.progress === -1 && event.downloaded === 12))
  assert.equal(dl.progress.at(-1).progress, 100)
  assert.equal(dl.progress.at(-1).total, bytes.length)
  assert.deepEqual(await fs.readFile(dl.filename), bytes)
})

for (const rangeHonored of [false, true]) {
  test(`resuming an unknown-size download when Range is ${rangeHonored ? 'honored' : 'ignored'} does not duplicate bytes`, { timeout: 5000 }, async t => {
    const f = await fixture(t, (req, res) => {
      let offset = 0
      if (rangeHonored) {
        offset = Number(/^bytes=(\d+)-$/.exec(req.headers.range)[1])
        res.writeHead(206, { 'Content-Range': `bytes ${offset}-${bytes.length - 1}/*` })
      }
      res.write(bytes.subarray(offset, offset + 5))
      setTimeout(() => res.end(bytes.subarray(offset + 5)), 10)
    })
    await fs.writeFile(path.join(f.directory, 'audio.mp3'), bytes.subarray(0, 25))
    const dl = f.start('/audio')
    await dl.completed
    assert.equal(f.requests[0].range, 'bytes=15-')
    assert.deepEqual(await fs.readFile(dl.filename), bytes)
    assert.equal(dl.task.progress.total, bytes.length)
  })
}

test('a truncated unknown-size stream fails instead of reporting success', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => {
    res.write(bytes.subarray(0, 12))
    setTimeout(() => res.destroy(), 20)
  })
  const dl = f.start('/audio')
  await assert.rejects(dl.completed, /aborted|reset|hang up/i)
  assert.notEqual(dl.task.status, 'COMPLETED')
})

test('redirects to unsupported protocols fail through the normal error event', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => res.writeHead(302, { Location: 'file:///not-a-download' }).end())
  await assert.rejects(f.start('/audio').completed, /Unsupported download protocol/)
})

test('C20: advertised size over the task limit is rejected before opening a file', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => res.end(bytes))
  const dl = f.start('/audio', 'limited.mp3', { maxBytes: bytes.length - 1 })
  await assert.rejects(dl.completed, { code: 'DOWNLOAD_TASK_SIZE_LIMIT' })
  await assert.rejects(fs.stat(dl.filename), { code: 'ENOENT' })
})

test('C20: unknown-size streams stop before writing bytes past the task limit', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => {
    res.write(bytes.subarray(0, 20))
    setTimeout(() => res.end(bytes.subarray(20)), 20)
  })
  const dl = f.start('/audio', 'chunked.mp3', { maxBytes: 30 })
  await assert.rejects(dl.completed, { code: 'DOWNLOAD_TASK_SIZE_LIMIT' })
  assert.equal((await fs.stat(dl.filename)).size, 20)
})

test('C20: resuming an already oversized task leaves its partial file intact', { timeout: 5000 }, async t => {
  const f = await fixture(t, (req, res) => {
    const start = Number(/^bytes=(\d+)-$/.exec(req.headers.range)[1])
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` }).end(bytes.subarray(start))
  })
  const partial = bytes.subarray(0, 40)
  await fs.writeFile(path.join(f.directory, 'resume.mp3'), partial)
  const dl = f.start('/audio', 'resume.mp3', { maxBytes: 30 })
  await assert.rejects(dl.completed, { code: 'DOWNLOAD_TASK_SIZE_LIMIT' })
  assert.deepEqual(await fs.readFile(dl.filename), partial)
})

test('C20: shared batch reservation caps concurrent downloads', { timeout: 5000 }, async t => {
  const f = await fixture(t, (_req, res) => res.end(bytes))
  let reserved = 0
  const limit = bytes.length + Math.floor(bytes.length / 2)
  const reserveBytes = count => {
    if (reserved + count > limit) return false
    reserved += count
    return true
  }
  const first = f.start('/first', 'first.mp3', { reserveBytes })
  const second = f.start('/second', 'second.mp3', { reserveBytes })
  const results = await Promise.allSettled([first.completed, second.completed])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'DOWNLOAD_BATCH_SIZE_LIMIT')
  assert.equal(reserved, bytes.length)
})
