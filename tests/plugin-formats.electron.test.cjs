const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { unpackPlugin } = require('../src/common/pluginPackage')
const { launch } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, uninstall, label } = require('./helpers/plugin-fixture.cjs')

test('the store installs LXPlugin directly and imports both package formats', { timeout: 120000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  let { app, page } = fixture
  const profilePath = fixture.output
  const id = 'audio-visualizer'
  const card = () => page.locator(`[data-plugin-id="${id}"]`)
  const snapshot = () => page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:list'))
  const idle = async() => page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).waitFor()
  try {
    page.setDefaultTimeout(10000)
    await mockGitHub(app)
    await openStore(page)
    await card().waitFor()
    await t.test('the list is text only and has no package format selector', async() => {
      assert.equal(await page.locator('[data-plugin-id] select').count(), 0)
      const entry = (await snapshot()).catalog.find(plugin => plugin.id === id)
      assert.equal(await card().getByText(`${(entry.packages.lxplugin.bytes / 1024 / 1024).toFixed(2)} MB`, { exact: true }).count(), 1)
      assert.equal((await app.evaluate(() => global.__pluginRequests)).every(url => url.endsWith('/catalog.json')), true)
      await page.screenshot({ path: path.join(profilePath, 'plugin-formats.png') })
    })
    await t.test('installation downloads LXPlugin and needs no source directory', async() => {
      await install(page, id)
      const installed = (await snapshot()).installed[id]
      assert.equal(installed.format, 'lxplugin')
      assert.equal((await fs.readdir(installed.directory)).includes('.source'), false)
      const requests = await app.evaluate(() => global.__pluginRequests)
      assert.equal(requests.some(url => url.endsWith('.lxplugin')), true)
      assert.equal(requests.some(url => url.endsWith('.zip')), false)
    })
    await t.test('ZIP imports through the dialog and compiles without downloading a package', async() => {
      await uninstall(page, id)
      const entry = (await snapshot()).catalog.find(plugin => plugin.id === id)
      const filename = path.resolve('plugins/store', entry.path)
      const requests = await app.evaluate(() => global.__pluginRequests.length)
      await app.evaluate(({ dialog }, filename) => {
        global.__pluginOffline = true
        dialog.showOpenDialog = async(_window, options) => {
          global.__formatOpenOptions = options
          return { canceled: false, filePaths: [filename] }
        }
        dialog.showMessageBox = async() => ({ response: 0 })
      }, filename)
      await page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).click()
      await idle()
      await card().getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).waitFor()
      const installed = (await snapshot()).installed[id]
      assert.equal(installed.source, 'local')
      assert.equal(installed.format, 'zip')
      assert.equal((await fs.readdir(installed.directory)).includes('.source'), true)
      assert.deepEqual(await app.evaluate(() => global.__formatOpenOptions.filters[0].extensions), ['lxplugin', 'zip'])
      assert.equal(await app.evaluate(() => global.__pluginRequests.length), requests)
      assert.equal((await fs.stat(filename)).isFile(), true)
      await app.evaluate(() => { global.__pluginOffline = false })
    })
    const exported = path.join(profilePath, 'offline.lxplugin')
    await t.test('LXPlugin exports and imports offline through the real dialogs', async() => {
      await uninstall(page, id)
      await install(page, id)
      await app.evaluate(({ dialog }, filename) => {
        global.__pluginOffline = true
        dialog.showSaveDialog = async(_window, options) => {
          global.__formatSaveOptions = options
          return { canceled: false, filePath: filename }
        }
        dialog.showOpenDialog = async(_window, options) => {
          global.__formatOpenOptions = options
          return { canceled: false, filePaths: [filename] }
        }
        dialog.showMessageBox = async() => ({ response: 0 })
      }, exported)
      await card().getByRole('button', { name: await label(page, 'setting__plugins_export'), exact: true }).click()
      await idle()
      assert.equal(unpackPlugin(await fs.readFile(exported)).manifest.id, id)
      assert.deepEqual(await app.evaluate(() => global.__formatSaveOptions.filters[0].extensions), ['lxplugin'])
      const requests = await app.evaluate(() => global.__pluginRequests.length)
      await uninstall(page, id)
      await page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).click()
      await idle()
      await card().getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).waitFor()
      assert.equal((await snapshot()).installed[id].source, 'local')
      assert.equal((await snapshot()).installed[id].format, 'lxplugin')
      assert.deepEqual(await app.evaluate(() => global.__formatOpenOptions.filters[0].extensions), ['lxplugin', 'zip'])
      assert.equal(await app.evaluate(() => global.__pluginRequests.length), requests)
    })
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    await mockGitHub(app, true)
    await openStore(page)
    await card().getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).waitFor()
    assert.equal((await snapshot()).installed[id].format, 'lxplugin')
    assert.deepEqual(fixture.errors, [])
    console.log('Package format screenshot:', path.join(profilePath, 'plugin-formats.png'))
  } finally {
    if (fixture) await fixture.app.close()
  }
})
