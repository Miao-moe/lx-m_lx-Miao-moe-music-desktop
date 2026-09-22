const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { after, before, test } = require('node:test')
const webpack = require('webpack')
const iconv = require('iconv-lite')
const { gzipSync } = require('node:zlib')

const projectDir = path.resolve(__dirname, '..')
const tempRoot = path.join(projectDir, '.npm')
let outputDir
let server
let baseUrl
let request

before(async() => {
  await fs.mkdir(tempRoot, { recursive: true })
  outputDir = await fs.mkdtemp(path.join(tempRoot, 'request-test-'))
  const storeFixture = path.join(outputDir, 'store.mjs')
  await fs.writeFile(storeFixture, 'export const proxy = { enable: false, host: "", port: "" }\n')
  const entryFixture = path.join(outputDir, 'entry.mjs')
  await fs.writeFile(entryFixture, `export * from ${JSON.stringify(path.join(projectDir, 'src/renderer/utils/request.js'))}; export { proxy as testProxy } from './store.mjs';`)
  const compiler = webpack({
    mode: 'production',
    target: 'electron-renderer',
    entry: entryFixture,
    output: { path: outputDir, filename: 'request.cjs', library: { type: 'commonjs2' } },
    resolve: { extensions: ['.js', '.ts'], alias: { '@renderer/store$': storeFixture, '@common': path.join(projectDir, 'src/common') } },
    module: { rules: [{ test: /\.ts$/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
    // Exercise the same constant folding and minification as the production renderer.
    optimization: { minimize: true },
  })
  try {
    await new Promise((resolve, reject) => compiler.run((error, stats) => {
      if (error) return reject(error)
      if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
      resolve()
    }))
  } finally {
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()))
  }
  request = require(path.join(outputDir, 'request.cjs'))
  server = http.createServer((req, res) => {
    if (req.url === '/cancel') return
    if (req.url === '/disconnect') return req.socket.destroy()
    if (req.url === '/gbk') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=gbk' })
      return res.end(iconv.encode('{"name":"中文歌曲"}', 'gbk'))
    }
    if (req.url === '/gzip') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' })
      return res.end(gzipSync('{"name":"压缩歌曲"}'))
    }
    if (req.url === '/json-text') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      return res.end('"123"')
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    if (req.url === '/stalled-body' || req.url === '/dripping-body') {
      res.write('{"list":[')
      if (req.url === '/dripping-body') {
        const timer = setInterval(() => res.write(' '), 20)
        res.on('close', () => clearInterval(timer))
      }
      return
    }
    res.end(JSON.stringify({ code: 200, list: [{ id: req.url }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + server.address().port
})

after(async() => {
  if (server) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  if (outputDir) {
    const resolved = await fs.realpath(outputDir)
    assert.equal(path.dirname(resolved), await fs.realpath(tempRoot))
    assert(path.basename(resolved).startsWith('request-test-'))
    await fs.rm(resolved, { recursive: true, force: true })
  }
})

test('production HTTP requests resolve with the server response', async() => {
  const responses = await Promise.all(['/playlists', '/leaderboard'].map(route => request.httpFetch(baseUrl + route).promise))
  for (const [index, response] of responses.entries()) {
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.code, 200)
    assert.equal(response.body.list[0].id, ['/playlists', '/leaderboard'][index])
  }
})

test('cancellation keeps a callable rejection handler', async() => {
  for (const afterStart of [false, true]) {
    const pending = request.httpFetch(baseUrl + '/cancel')
    const rejected = assert.rejects(pending.promise, error => error instanceof Error && error.message === '取消http请求')
    if (afterStart) await new Promise(resolve => setImmediate(resolve))
    pending.cancelHttp()
    await rejected
  }
})

test('a network failure rejects with an Error', async() => {
  await assert.rejects(request.httpFetch(baseUrl + '/disconnect').promise, error => error instanceof Error && error.code === 'ECONNRESET' && error.cause?.code === 'ECONNRESET')
})

test('B18: JSON parsing preserves decoded charsets, compression and string primitives', async() => {
  assert.equal((await request.httpFetch(baseUrl + '/gbk').promise).body.name, '中文歌曲')
  assert.equal((await request.httpFetch(baseUrl + '/gzip').promise).body.name, '压缩歌曲')
  assert.equal((await request.httpFetch(baseUrl + '/json-text').promise).body, '123')
})

test('B19: proxy requests reuse a connection and changing the proxy retires its pool', async() => {
  const sockets = new Set()
  const proxy = http.createServer((req, res) => {
    sockets.add(req.socket)
    res.setHeader('Content-Type', 'application/json')
    res.end('{"proxied":true}')
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
  Object.assign(request.testProxy, { enable: true, host: '127.0.0.1', port: String(proxy.address().port) })
  try {
    for (let i = 0; i < 3; i++) assert.equal((await request.httpFetch(baseUrl + '/proxy').promise).body.proxied, true)
    assert.equal(sockets.size, 1)
    request.testProxy.enable = false
    assert.equal((await request.httpFetch(baseUrl + '/direct').promise).body.list[0].id, '/direct')
    request.testProxy.enable = true
    await request.httpFetch(baseUrl + '/proxy').promise
    assert.equal(sockets.size, 2)
  } finally {
    request.testProxy.enable = false
    await request.httpFetch(baseUrl + '/direct').promise
    proxy.closeAllConnections()
    await new Promise(resolve => proxy.close(resolve))
  }
})

test('B13: abort signals terminate body reads after response headers', async() => {
  const controller = new AbortController()
  const pending = request.httpFetch(baseUrl + '/stalled-body', { timeout: 1000, signal: controller.signal })
  const rejected = assert.rejects(pending.promise, { name: 'AbortError' })
  await new Promise(resolve => setTimeout(resolve, 40))
  controller.abort()
  await rejected
})

test('the deadline covers both a stalled body and a continuously dripping body', { timeout: 3000 }, async() => {
  for (const route of ['/stalled-body', '/dripping-body']) {
    const started = Date.now()
    await assert.rejects(request.httpFetch(baseUrl + route, { timeout: 120 }).promise, error => error.message === '请求超时' && error.code === 'ETIMEDOUT' && error.cause?.code === 'ETIMEDOUT')
    assert(Date.now() - started < 1000)
  }
})

test('body timeout calls the callback once and cancellation also completes after headers', { timeout: 3000 }, async() => {
  let callbacks = 0
  await new Promise((resolve, reject) => {
    request.httpGet(baseUrl + '/stalled-body', { timeout: 100 }, error => {
      callbacks++
      if (error?.code !== 'ETIMEDOUT') return reject(error || new Error('expected timeout'))
      resolve()
    })
  })
  const pending = request.httpFetch(baseUrl + '/stalled-body', { timeout: 1000 })
  const rejected = assert.rejects(pending.promise, /取消http请求/)
  await new Promise(resolve => setTimeout(resolve, 40))
  pending.cancelHttp()
  await rejected
  await new Promise(resolve => setTimeout(resolve, 150))
  assert.equal(callbacks, 1)
})

test('callback POST requests also survive production logging optimization', async() => {
  const response = await new Promise((resolve, reject) => {
    request.httpPost(baseUrl + '/callback', { value: 1 }, {}, (error, response) => error ? reject(error) : resolve(response))
  })
  assert.equal(response.statusCode, 200)
  assert.equal(response.body.list[0].id, '/callback')
})
