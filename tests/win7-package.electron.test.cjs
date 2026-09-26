const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { _electron } = require('playwright-core')
const { route } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label } = require('./helpers/plugin-fixture.cjs')

test('distribution starts with its packaged database, playback and offline source compiler', { skip: !process.env.LX_TEST_WIN7_PACKAGE, timeout: 180000 }, async() => {
  const expectedElectron = process.env.LX_TEST_PACKAGE_ELECTRON ?? '22.3.27'
  const directory = path.resolve(process.env.LX_TEST_WIN7_PACKAGE)
  const archive = path.join(directory, 'resources/app.asar')
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-win7-package-'))
  const runtime = path.join(output, 'runtime')
  if (path.dirname(path.resolve(runtime)) !== path.resolve(output)) throw new Error('Invalid temporary runtime directory')
  // Run the distribution's own executable and DLLs with a wrapper that prevents
  // protocol registration and redirects personal data. Load the original ASAR.
  await fs.cp(directory, runtime, { recursive: true, filter: filename => path.basename(filename) !== 'resources' })
  await fs.mkdir(path.join(output, 'portable'))
  const appDirectory = path.join(runtime, 'resources/app')
  await fs.mkdir(appDirectory, { recursive: true })
  await fs.writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'win7-package-test', version: '1.0.0', main: 'index.cjs' }))
  const wrapper = path.join(appDirectory, 'index.cjs')
  await fs.writeFile(wrapper, `const {app}=require('electron');
    app.setAppPath(${JSON.stringify(archive)});
    app.getVersion=()=>require(${JSON.stringify(archive + '/package.json')}).version;
    Object.defineProperty(app,'isPackaged',{get:()=>true});
    app.setAsDefaultProtocolClient=()=>false;app.removeAsDefaultProtocolClient=()=>false;
    app.setLoginItemSettings=()=>{};app.setUserTasks=()=>true;app.setJumpList=()=>'ok';
    require(${JSON.stringify(archive + '/dist/main.js')});`)
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: output }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  try {
    app = await _electron.launch({ executablePath: path.join(runtime, 'LX-M Music.exe'), args: ['-hidden', '-dha'], env })
    app.on('console', message => { if (message.text().includes('Plugin transfer failed:')) console.error(message.text()) })
    const page = await app.firstWindow()
    page.setDefaultTimeout(20000)
    await page.waitForSelector('#container')
    const usesNativeQrc = expectedElectron === '22.3.27'
    const versions = await app.evaluate(({ app }, usesNativeQrc) => ({
      ...process.versions,
      arch: process.arch,
      qrc: usesNativeQrc ? typeof process.mainModule.require(app.getAppPath() + '/build/Release/qrc_decode.node').qrc_decode === 'function' : null,
    }), usesNativeQrc)
    assert.equal(versions.electron, expectedElectron)
    if (expectedElectron === '22.3.27') assert.equal(versions.node, '16.17.1')
    if (usesNativeQrc) assert.equal(versions.qrc, true)
    await page.evaluate(() => {
      Object.assign(window.lxData.appSetting, { 'common.isAgreePact': true, 'common.showChangeLog': false })
      window.lxData.versionInfo.showModal = false
      window.lxData.versionInfo.newVersion = { version: window.lxData.versionInfo.version, history: [], desc: '' }
    })
    const decoded = await page.evaluate(() => require('electron').ipcRenderer.invoke('winMain_handle_tx_decode_lyric', {
      lrc: '32dabb4c5e9846faa7e76c9531cc4d78e9c22f000fd0945e831b422b53b4537f86edbb1d70963667dd72c858c66ec28b6acec8f144928bad',
      tlrc: '',
      rlrc: '',
    }))
    assert.equal(decoded.lyric, '[00:00.00]测试歌词 🎵\n[00:01.23]Line two')
    const window = await app.browserWindow(page)
    await window.evaluate(window => window.showInactive())
    await window.dispose()
    const bytes = Buffer.alloc(44 + 8000 * 90 * 2)
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
    bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
    const filePath = path.join(output, '兼容测试.wav')
    await fs.writeFile(filePath, bytes)
    await page.evaluate(async filePath => {
      const song = { id: 'win7-package', name: '兼容测试', singer: 'LX-M', source: 'local', interval: '01:30', meta: { filePath, ext: 'wav' } }
      await require('electron').ipcRenderer.invoke('player_list_data_overwire', { defaultList: [], loveList: [song], tempList: [], userList: [] })
      window.__lxPluginHost.player.setVolume(0)
    }, filePath)
    await route(page, '/list?id=love')
    await page.locator('[data-song-id="win7-package"] [data-music-cell="index"]').dblclick()
    await page.waitForFunction(() => !window.__lxPluginHost.player.getAudioElement().paused && window.__lxPluginHost.player.getDuration() >= 89)
    await page.evaluate(() => window.__lxPluginHost.player.setVolumeNormalization(true))
    await page.locator('#player').getByRole('button', { name: /开启迷你播放器/ }).click()
    const mini = app.windows().find(page => page.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: page => page.url().includes('lyric.html') })
    await mini.locator('h1').filter({ hasText: '兼容测试' }).waitFor()
    const source = require('../plugins/development-examples/index.json').plugins.find(plugin => plugin.id === 'folia-lyrics')
    await mockGitHub(app, true)
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] })
      dialog.showMessageBox = async() => ({ response: 0 })
      process.env.PATH = ''
    }, path.resolve('plugins/development-examples', source.file))
    await openStore(page)
    const importButton = page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true })
    await importButton.click()
    await importButton.waitFor({ timeout: 120000 })
    assert.equal(await page.locator('[data-plugin-transfer-status]').innerText(), await label(page, 'setting__plugins_import_success'))
    const installed = await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:list'))
    assert.equal(installed.installed['folia-lyrics'].format, 'zip')
    const result = { electron: versions.electron, node: versions.node, chromium: versions.chrome, arch: versions.arch, qrc: true, sqlite: true, playback: true, normalization: true, miniPlayer: true, sourceCompiler: true }
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2))
    console.log('Packaged distribution verification:', JSON.stringify(result), output)
  } finally {
    if (app) await app.close()
    await fs.rm(runtime, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
