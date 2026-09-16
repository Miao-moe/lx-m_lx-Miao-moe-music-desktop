const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const load = require('./helpers/load-typescript.cjs')

const project = path.resolve(__dirname, '..')
const cache = path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'nsis')
const nsis = process.env.LX_TEST_MAKENSIS || (fs.existsSync(cache) && fs.readdirSync(cache)
  .map(dir => path.join(cache, dir, 'Bin', 'makensis.exe')).find(file => fs.existsSync(file)))

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lx-update-nsis-测试 & user's "))
  const exe = path.join(root, 'LX-M Music-v9.0.0-x64-Setup.exe')
  const result = path.join(root, 'nsis-result.txt')
  const installDirectory = path.join(root, "音乐 & user's app")
  const cleanup = []
  fs.mkdirSync(installDirectory)
  const compile = childProcess.spawnSync(nsis, [
    '/V2', '/DOUTPUT_FILE=' + exe, '/DPROBE_RESULT=' + result, path.join(__dirname, 'fixtures/update-installer.nsi'),
  ], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
  assert.equal(compile.status, 0, compile.error?.message || compile.stdout + compile.stderr)
  t.after(async() => {
    for (const dispose of cleanup.reverse()) await dispose()
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert(path.basename(root).startsWith('lx-update-nsis-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  const readResult = async() => {
    for (let i = 0; !fs.existsSync(result) && i < 200; i++) await delay(25)
    assert(fs.existsSync(result), 'NSIS must finish silently with both update/relaunch flags')
    // File creation precedes its last write by a few milliseconds.
    for (let i = 0; i < 100; i++) {
      const lines = fs.readFileSync(result).toString('utf16le').split('\r\n')
      if (lines[2] == 'silent=1;updated=1;force-run=1') return lines
      await delay(10)
    }
    throw Error('NSIS probe did not finish writing')
  }
  return { root, exe, result, installDirectory, readResult, cleanup }
}

test('real NSIS receives the exact directory and silent/relaunch flags through CreateProcess', {
  skip: process.platform != 'win32' || !nsis,
  timeout: 30000,
}, async(t) => {
  const f = fixture(t)
  const api = load({ 'node:child_process': childProcess, 'node:fs': fs, 'node:path': path })(path.join(project, 'src/main/modules/winMain/updateInstaller.ts'))
  await api.launchWindowsInstaller(f.exe, f.installDirectory, path.join(f.installDirectory, 'resources'))
  const lines = await f.readResult()
  assert.equal(lines[0], f.installDirectory)
  assert(lines[1].startsWith('"' + f.exe + '" '))
  // NSIS consumes /D before exposing $CMDLINE; $INSTDIR above is its parsed value.
  assert(lines[1].includes('--updated /S --force-run'))
})

test('the real update buttons report a missing package, then download and launch NSIS before quitting', {
  skip: process.platform != 'win32' || !nsis,
  timeout: 60000,
}, async(t) => {
  const f = fixture(t)
  const bytes = fs.readFileSync(f.exe)
  fs.writeFileSync(path.join(f.installDirectory, 'Uninstall LX-M Music.exe'), 'installed-edition test marker')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length })
    res.end(bytes)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const fixtureApp = await launch({ profilePath: path.join(f.root, 'profile'), rendererPath: path.join(project, 'dist/index.html') })
  const { app, page, errors } = fixtureApp
  let closed = false
  let downloadedFiles = []
  app.on('close', () => { closed = true })
  f.cleanup.push(async() => {
    if (!closed) await app.close().catch(() => {})
    server.closeAllConnections()
    await new Promise(resolve => { server.close(resolve) })
    for (const file of downloadedFiles) {
      const directory = path.dirname(file)
      assert.equal(path.dirname(directory), os.tmpdir())
      assert(path.basename(directory).startsWith('lx-m-update-'))
      try { fs.unlinkSync(file) } catch {}
      try { fs.rmdirSync(directory) } catch {}
    }
  })
  await app.evaluate(({ app }, exe) => {
    const getPath = app.getPath.bind(app)
    app.getPath = name => name == 'exe' ? exe : getPath(name)
    Object.defineProperty(app, 'isPackaged', { value: true, configurable: true })
    const fs = process.getBuiltinModule('fs')
    const mkdtemp = fs.mkdtempSync
    global.__updateTestDirectories = []
    fs.mkdtempSync = (...args) => {
      const directory = mkdtemp(...args)
      if (process.getBuiltinModule('path').basename(directory).startsWith('lx-m-update-')) global.__updateTestDirectories.push(directory)
      return directory
    }
  }, path.join(f.installDirectory, 'LX-M Music.exe'))
  await page.evaluate(info => {
    const state = window.lxData.versionInfo
    Object.assign(state.newVersion, info)
    Object.assign(state, { isLatest: false, isUnknown: false, reCheck: false, status: 'downloaded', showModal: true })
  }, {
    version: '9.0.0',
    desc: '## v9.0.0\n\n### 修复\n\n- 更新测试',
    history: [],
    fileName: path.basename(f.exe),
    downloadUrl: `http://127.0.0.1:${server.address().port}/Setup.exe`,
    size: bytes.length,
    digest: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
  })
  await page.getByRole('button', { name: '立即重启更新', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '更新安装包不存在' }).waitFor()
  assert.equal(closed, false, 'failed preparation must leave the application running')
  await page.getByRole('button', { name: '自动更新', exact: true }).click()
  await page.getByRole('button', { name: '立即重启更新', exact: true }).waitFor()
  downloadedFiles = await app.evaluate(() => global.__updateTestDirectories.map(dir => {
    const fs = process.getBuiltinModule('fs')
    const path = process.getBuiltinModule('path')
    return fs.readdirSync(dir).map(name => path.join(dir, name))
  }).flat())
  assert.equal(downloadedFiles.length, 1)
  const closing = app.waitForEvent('close')
  await page.getByRole('button', { name: '立即重启更新', exact: true }).click()
  await closing
  const lines = await f.readResult()
  assert.equal(lines[0], f.installDirectory)
  assert(fs.existsSync(downloadedFiles[0]), 'quitting must not delete the running installer')
  assert.deepEqual(errors, [])
})
