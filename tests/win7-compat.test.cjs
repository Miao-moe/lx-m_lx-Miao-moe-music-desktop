const assert = require('node:assert/strict')
const path = require('node:path')
const http = require('node:http')
const { test } = require('node:test')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const load = require('./helpers/load-typescript.cjs')

const project = path.resolve(__dirname, '..')
const workspace = path.join(project, 'build/win7/workspace')
const legacyRequire = createRequire(path.join(workspace, 'package.json'))

test('H04: the pinned image-size 2.0.4 buffer parser runs on the legacy Node 16 runtime', () => {
  const filename = path.join(project, 'node_modules/image-size')
  const code = `
    const assert = require('assert').strict;
    const imageSize = require(${JSON.stringify(filename)}).imageSize;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5kAAAAASUVORK5CYII=', 'base64');
    assert.equal(imageSize(png).width, 1);
    assert.equal(imageSize(Buffer.from('<svg width="32" height="16" xmlns="http://www.w3.org/2000/svg"></svg>')).height, 16);
    for (const bytes of [Buffer.alloc(0), Buffer.from('icns0000'), Buffer.from([0xff, 0x0a])]) {
      assert.throws(() => imageSize(bytes));
    }
  `
  const result = spawnSync(legacyRequire('electron'), ['-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test('Win7 and regular editions cannot select each other\'s installers', () => {
  const { getWindowsSetupPriority: priority } = load({})('src/common/utils/update.ts')
  for (const arch of ['x64', 'ia32']) {
    const suffix = arch === 'ia32' ? 'x86' : 'x64'
    const modern = `LX-M Music-v2.6.1-${suffix}-Setup.exe`
    const legacy = `LX-M Music-v2.6.1-win7_${suffix}-Setup.exe`
    assert.equal(priority(legacy, arch, true), 2)
    assert.equal(priority(modern, arch, true), 0)
    assert.equal(priority(legacy, arch, false), 0)
    assert.equal(priority(modern, arch, false), 2)
    assert.equal(priority(`LX-M Music-v2.6.1-win7_${suffix}-green.7z`, arch, true), 0)
    assert.equal(priority('LX-M Music-v2.6.1-win7_arm64-Setup.exe', arch, true), 0)
  }
})

for (const [name, requireDependency] of [['regular', require], ['win7', legacyRequire]]) {
  test(`${name}: real HTTP redirects, raw data, retry limits and cancellation`, async t => {
    const undici = requireDependency('undici')
    const previous = undici.getGlobalDispatcher()
    const agent = new undici.Agent()
    undici.setGlobalDispatcher(agent)
    t.after(async() => { undici.setGlobalDispatcher(previous); await agent.close() })
    const compat = load({ undici, 'node:timers/promises': require('node:timers/promises') })('src/common/utils/undiciCompat.ts')
    const api = load({ undici, './undiciCompat': compat, 'node:querystring': require('node:querystring') })('src/common/utils/request.ts')
    let attempts = 0
    const sockets = new Set()
    const server = http.createServer((req, res) => {
      if (req.url === '/hang') return
      if (req.url === '/drip') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('[')
        const timer = setInterval(() => res.write(' '), 20)
        res.on('close', () => clearInterval(timer))
        return
      }
      if (req.url.startsWith('/redirect/')) {
        res.writeHead(Number(req.url.split('/')[2]), { location: '../../raw' })
        return res.end()
      }
      if (req.url === '/retry' && ++attempts < 2) { res.writeHead(503); return res.end('retry') }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(Buffer.from([0, 127, 255]))
    })
    server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async() => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
    const base = `http://127.0.0.1:${server.address().port}`
    for (const status of [301, 302, 303, 307, 308]) {
      const result = await api.request(`${base}/redirect/${status}`, { needRaw: true, retryNum: 0 })
      assert.equal(result.statusCode, 200)
      assert.deepEqual([...result.raw], [0, 127, 255])
    }
    assert.equal((await api.request(base + '/redirect/302', { maxRedirect: 0, retryNum: 0 })).statusCode, 302)
    assert.equal((await api.request(base + '/retry', { retryNum: 0 })).statusCode, 503)
    assert.equal(attempts, 1)
    attempts = 0
    assert.equal((await api.request(base + '/retry', { retryNum: 1 })).statusCode, 200)
    assert.equal(attempts, 2)
    const controller = new AbortController()
    const pending = api.request(base + '/hang', { signal: controller.signal })
    controller.abort()
    await assert.rejects(pending, /abort/i)
    const start = Date.now()
    await assert.rejects(api.request(base + '/drip', { timeout: 100, retryNum: 2 }), error => error.code === 'ETIMEDOUT')
    assert(Date.now() - start < 1000, 'B01/B15: buffered response has a total body deadline on both runtimes')
    const download = compat.composeDispatcher(new undici.Agent(), 5)
    try {
      const result = await compat.requestWithCompatibility(base + '/redirect/307', { dispatcher: download, method: 'GET' })
      assert.equal(result.statusCode, 200)
      assert.deepEqual([...new Uint8Array(await result.body.arrayBuffer())], [0, 127, 255])
    } finally { await download.close() }
  })
}

test('embedded lyrics accept both metadata generations and reject malformed tags', () => {
  const api = load({
    '@common/utils/nodejs': {}, '@common/utils/common': {}, '@common/utils/lyricUtils/kg': {},
  })('src/renderer/utils/music.ts')
  assert.equal(api.getEmbeddedLyricText('lyrics'), 'lyrics')
  assert.equal(api.getEmbeddedLyricText({ language: 'eng', text: 'lyrics' }), 'lyrics')
  for (const value of [null, undefined, 8, {}, { text: 8 }]) assert.equal(api.getEmbeddedLyricText(value), undefined)
})

test('actual Electron 22 runtime loads SQLite, metadata, browser login and the WASM compiler', { timeout: 30000 }, () => {
  const code = `
    const assert = require('assert').strict;
    const path = require('path');
    assert.equal(process.versions.electron, '22.3.27');
    assert.equal(process.versions.node, '16.17.1');
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE sample (id TEXT PRIMARY KEY, data TEXT);');
    db.prepare('INSERT INTO sample VALUES (?, ?)').run('歌曲', JSON.stringify({title: '测试'}));
    assert.equal(db.prepare("SELECT json_extract(data, '$.title') AS title FROM sample").get().title, '测试');
    db.close();
    assert.equal(typeof require('./build/Release/qrc_decode.node').qrc_decode, 'function');
    assert.equal(typeof require('playwright-core').chromium.launchPersistentContext, 'function');
    require('./dist/plugin-compiler/load-tailwind.cjs')();
    const css = require('./dist/plugin-compiler/legacy-css-loader.cjs').call({resourcePath:'compat.css'}, ':root{--test:oklch(62% .2 29)} .test{color:var(--test);&:hover{color:red}}');
    assert(css.includes('.test:hover'));assert(css.includes('--test: #'));assert(!css.includes('oklch('));
    const wasm = require('./dist/plugin-compiler/node_modules/@tailwindcss/oxide-wasm32-wasi');
    const scanner = new wasm.Scanner({sources: []});
    assert(scanner.scanFiles([{content: '<div class="p-4 text-red-500"></div>', extension: 'html'}]).includes('text-red-500'));
    import('music-metadata').then(async metadata => {
      const bytes = Buffer.alloc(46);bytes.write('RIFF');bytes.writeUInt32LE(38,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(88200,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(2,40);
      const result = await metadata.parseBuffer(bytes, 'audio/wav');assert.equal(result.format.sampleRate,44100);
      console.log(JSON.stringify({electron:process.versions.electron,node:process.versions.node,arch:process.arch,sqlite:true,metadata:true,playwright:true,wasm:true}));process.exit(0);
    }).catch(error => { console.error(error);process.exit(1) });
  `
  const result = spawnSync(legacyRequire('electron'), ['--experimental-wasi-unstable-preview1', '-e', code], {
    cwd: workspace, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 25000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? ''))
})
