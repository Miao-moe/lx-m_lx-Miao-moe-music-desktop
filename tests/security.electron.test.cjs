const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke(name, params), { name, params })

test('H01/H03/H06/H09: real Electron credential persistence, IPC policy, QRC and remote sandbox', { timeout: 120000 }, async t => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = f.output
  try {
    const root = await f.app.evaluate(() => global.lxDataPath)
    await t.test('system encryption excludes credentials from config and exported backups', async() => {
      await invoke(f.page, 'common_set_app_setting', { 'cookie.wy': 'security-test-session', 'sync.webdav.password': 'security-test-dav' })
      const filename = path.join(root, 'config_v2.json')
      const config = await fs.readFile(filename, 'utf8'); const vault = await fs.readFile(path.join(root, 'credentials.json'), 'utf8')
      for (const text of [config, vault]) assert(!text.includes('security-test-session') && !text.includes('security-test-dav'))
      const backupFile = path.join(profilePath, 'secure-backup.lxmc')
      await invoke(f.page, 'backup_export', { path: backupFile, kind: 'all' })
      const backup = JSON.parse(zlib.gunzipSync(await fs.readFile(backupFile)).toString())
      assert(!Object.hasOwn(backup.data.settings, 'cookie.wy'))
      assert(!Object.hasOwn(backup.data.settings, 'sync.webdav.password'))
      assert.equal((await invoke(f.page, 'common_get_app_setting'))['cookie.wy'], 'security-test-session')
    })
    await t.test('unregistered window and malformed arguments cannot use privileged handlers', async() => {
      await assert.rejects(invoke(f.page, 'common_set_app_setting', { 'cookie.wy': 123 }), /IPC_ARGUMENT_INVALID/)
      const result = await f.app.evaluate(async({ BrowserWindow }) => {
        const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } })
        await window.loadURL('data:text/html,untrusted')
        try { return await window.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('common_get_app_setting').then(() => 'unexpected success', error => error.message)") } finally { window.destroy() }
      })
      assert.match(result, /IPC_SENDER_DENIED/)
    })
    await t.test('registered custom source can initialize, answer requests and report initialization errors', async() => {
      const script = '/**\n * @name Security source fixture\n */\n' +
        "lx.on(lx.EVENT_NAMES.request, async () => 'https://audio.example.com/fixture.mp3'); lx.send(lx.EVENT_NAMES.inited, {sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});"
      const imported = await invoke(f.page, 'winMain_import_user_api', script)
      const waitStatus = async(id, expected) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const status = await invoke(f.page, 'winMain_get_user_api_status')
          if (status.apiInfo?.id === id && status.status === expected) return status
          await new Promise(resolve => setTimeout(resolve, 20))
        }
        assert.fail('Custom source initialization did not finish')
      }
      try {
        await invoke(f.page, 'winMain_set_user_api', imported.apiInfo.id)
        await waitStatus(imported.apiInfo.id, true)
        const result = await invoke(f.page, 'winMain_request_user_api', { requestKey: 'security-user-api', data: { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: {} } } })
        assert.equal(result.data.url, 'https://audio.example.com/fixture.mp3')
      } finally { await invoke(f.page, 'winMain_remove_user_api', [imported.apiInfo.id]) }
      const invalid = await invoke(f.page, 'winMain_import_user_api', '/**\n * @name Invalid security fixture\n */\nlx.send(lx.EVENT_NAMES.inited);')
      try {
        await invoke(f.page, 'winMain_set_user_api', invalid.apiInfo.id)
        assert.match((await waitStatus(invalid.apiInfo.id, false)).message, /Missing required parameter/)
      } finally { await invoke(f.page, 'winMain_remove_user_api', [invalid.apiInfo.id]) }
    })
    await t.test('portable QRC decoder matches the native decoder reference vector under the selected runtime', async() => {
      const expected = require(path.join(process.env.LX_TEST_PROJECT ?? path.resolve('.'), 'package.json')).devDependencies.electron
      assert.equal(await f.app.evaluate(() => process.versions.electron), expected)
      const result = await invoke(f.page, 'winMain_handle_tx_decode_lyric', { lrc: '32dabb4c5e9846faa7e76c9531cc4d78e9c22f000fd0945e831b422b53b4537f86edbb1d70963667dd72c858c66ec28b6acec8f144928bad', tlrc: '', rlrc: '' })
      assert.equal(result.lyric, '[00:00.00]测试歌词 🎵\n[00:01.23]Line two')
    })
    await t.test('sandbox cannot access Node, ambient network or undeclared origins; allowed broker requests work', async() => {
      const code = 'module.exports = env => ({ id: \'security-test-source\', name: \'Test source\', inspect() { return { require: typeof require, process: typeof process, node: typeof global, digest: env.crypto.md5(\'test\') } }, async ambient() { try { await fetch(\'https://example.com/\'); return \'unexpected\' } catch { return \'blocked\' } }, async denied() { return env.httpFetch(\'https://evil.example/\', { format: \'json\' }).promise }, async allowed() { return env.httpFetch(\'https://api.example.com/status\', { format: \'json\' }).promise }, async hang() { return new Promise(() => {}) }, cpu() { while (true) {} } })'
      await f.app.evaluate((_, code) => {
        const require = process.mainModule.require.bind(process.mainModule); const https = require('node:https'); const { EventEmitter } = require('node:events'); const { Readable } = require('node:stream')
        global.__sourceOriginalRequest = https.request
        https.request = (url, ...args) => {
          if (!['plugins.example.com', 'api.example.com'].includes(url.hostname)) return global.__sourceOriginalRequest(url, ...args)
          const req = new EventEmitter()
          req.destroy = () => {}
          req.end = () => setImmediate(() => { const body = url.hostname === 'plugins.example.com' ? code : '{"ok":true}'; const res = Readable.from([Buffer.from(body)]); res.statusCode = 200; res.headers = { 'content-type': url.hostname === 'plugins.example.com' ? 'text/plain' : 'application/json' }; req.emit('response', res) })
          return req
        }
      }, code)
      const manifest = { id: 'security-test-source', version: '1.0.0', url: 'https://plugins.example.com/v1/plugin.js', sha256: crypto.createHash('sha256').update(code).digest('hex'), allowedOrigins: ['https://api.example.com'] }
      try {
        await assert.rejects(invoke(f.page, 'source_plugin:load', { ...manifest, sha256: '0'.repeat(64) }), /SOURCE_DIGEST_MISMATCH/)
        const descriptor = await invoke(f.page, 'source_plugin:load', manifest)
        assert.equal(descriptor.id, manifest.id)
        const call = method => invoke(f.page, 'source_plugin:call', { id: manifest.id, callId: method, method, args: [] })
        assert.deepEqual(await call('inspect'), { require: 'undefined', process: 'undefined', node: 'undefined', digest: '098f6bcd4621d373cade4e832627b4f6' })
        assert.equal(await call('ambient'), 'blocked')
        await assert.rejects(call('denied'), /SOURCE_ORIGIN_DENIED/)
        assert.deepEqual((await call('allowed')).body, { ok: true })
        const cancelled = assert.rejects(call('hang'), /SOURCE_CALL_CANCELLED/)
        await f.page.evaluate(id => require('electron').ipcRenderer.send('source_plugin:cancel', { id, callId: 'hang' }), manifest.id)
        await cancelled
        await f.app.evaluate(() => {
          global.__securitySetTimeout = global.setTimeout
          global.setTimeout = (callback, ms, ...args) => global.__securitySetTimeout(callback, ms === 20000 ? 100 : ms, ...args)
        })
        try {
          await assert.rejects(call('cpu'), /SOURCE_CALL_TIMEOUT/)
          assert.equal((await invoke(f.page, 'common_get_app_setting'))['cookie.wy'], 'security-test-session')
          await invoke(f.page, 'source_plugin:load', manifest)
          const stopped = assert.rejects(call('cpu'), /SOURCE_CALL_CANCELLED/)
          await f.page.evaluate(id => require('electron').ipcRenderer.send('source_plugin:cancel', { id, callId: 'cpu' }), manifest.id)
          await stopped
          for (let attempt = 0; attempt < 100 && await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle() === 'Source sandbox')); attempt++) await new Promise(resolve => setTimeout(resolve, 10))
          assert.equal(await f.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.getTitle() === 'Source sandbox')), false, 'cancelled infinite loops still have a deadline')
        } finally { await f.app.evaluate(() => { global.setTimeout = global.__securitySetTimeout }) }
      } finally { await f.app.evaluate(() => { process.mainModule.require('node:https').request = global.__sourceOriginalRequest }) }
    })
    await f.app.close()
    // This fixture has one owner; all child tests above have finished.
    // eslint-disable-next-line require-atomic-updates
    f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
    await t.test('encrypted credentials survive restart and remain out of the public config', async() => {
      assert.equal((await invoke(f.page, 'common_get_app_setting'))['sync.webdav.password'], 'security-test-dav')
      assert(!(await fs.readFile(path.join(root, 'config_v2.json'), 'utf8')).includes('security-test-dav'))
    })
    assert.deepEqual(f.errors, [])
  } finally { await f.app.close().catch(() => {}) }
})
