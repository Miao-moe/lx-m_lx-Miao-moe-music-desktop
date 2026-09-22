const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { packSource, unpackSource } = require('../src/common/pluginSource')
const { test } = require('node:test')
const { launch, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label } = require('./helpers/plugin-fixture.cjs')

function plugin(id, version, apiVersion = 3) {
  const files = {
    'src/index.js': Buffer.from(`const { h } = window.__lxPluginHost.vue;
export default {
  activate() {
    (window.__transferEvents ??= []).push('activate:${version}');
    return () => window.__transferEvents.push('deactivate:${version}');
  },
  components: { Settings: { setup: () => () => h('div', { 'data-transfer-settings': '${id}' }, '${version}') } }
};`),
    'src/assets/example.txt': Buffer.from('Packaged asset'),
    'src/licenses/NOTICE.txt': Buffer.from('Keep this license'),
  }
  const manifest = {
    id,
    version,
    apiVersion,
    name: { 'zh-cn': '离线测试插件', 'en-us': 'Offline test plugin' },
    description: '从本地文件导入的插件',
    entry: 'src/index.js',
    assets: [{ from: 'src/assets', to: 'assets' }, { from: 'src/licenses', to: 'licenses' }],
  }
  return packSource(manifest, new Map(Object.entries(files)))
}

const mockDialogs = app => app.evaluate(({ dialog }) => {
  global.__transferDialogs = { incoming: null, destination: null, response: 0, confirmations: [], waiting: false }
  dialog.showOpenDialog = async(_window, options) => {
    global.__transferDialogs.openOptions = options
    const filename = global.__transferDialogs.incoming
    return { canceled: !filename, filePaths: filename ? [filename] : [] }
  }
  dialog.showSaveDialog = async(_window, options) => {
    global.__transferDialogs.saveOptions = options
    return { canceled: !global.__transferDialogs.destination, filePath: global.__transferDialogs.destination }
  }
  dialog.showMessageBox = async(_window, options) => {
    global.__transferDialogs.confirmations.push(options)
    if (global.__transferDialogs.waiting) return new Promise(resolve => { global.__finishTransferConfirmation = resolve })
    return { response: global.__transferDialogs.response }
  }
})
const choose = (app, values) => app.evaluate((_electron, values) => Object.assign(global.__transferDialogs, values), values)
const click = async(page, key, scope = page) => scope.getByRole('button', { name: await label(page, key), exact: true }).click()
const idle = async page => page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).waitFor()
const status = page => page.locator('[data-plugin-transfer-status]')

test('the store imports and exports local packages offline through the real UI and IPC', { timeout: 120000 }, async t => {
  const id = 'transfer-' + randomUUID().slice(0, 8)
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const filename = path.join(profilePath, 'input.zip')
  const backup = path.join(profilePath, 'backup.zip')
  const prepare = async(version, apiVersion) => {
    await fs.writeFile(filename, await plugin(id, version, apiVersion))
    await choose(app, { incoming: filename, response: 0 })
  }
  const importChosen = async() => { await click(page, 'setting__plugins_import'); await idle(page) }
  const card = () => page.locator(`[data-plugin-id="${id}"]`)
  const version = async expected => {
    const settings = card().getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true })
    if (await settings.count()) await settings.click()
    await page.waitForFunction(({ id, expected }) => document.querySelector(`[data-transfer-settings="${id}"]`)?.textContent === expected, { id, expected })
  }
  try {
    page.setDefaultTimeout(10000)
    await mockGitHub(app, true)
    await mockDialogs(app)
    await openStore(page)
    await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).waitFor()

    await t.test('cancelling file selection makes no changes', async() => {
      await importChosen()
      assert.equal(await card().count(), 0)
      assert.equal(await status(page).count(), 0)
      assert.deepEqual(await app.evaluate(() => global.__transferDialogs.openOptions.filters[0].extensions), ['lxplugin', 'zip'])
    })
    await t.test('an unknown local plugin loads immediately with its own metadata and source', async() => {
      await prepare('1.0.0')
      const requests = await app.evaluate(() => global.__pluginRequests.length)
      await importChosen()
      assert.equal(await card().locator('h3').innerText(), '离线测试插件')
      await card().getByText(await label(page, 'setting__plugins_local'), { exact: false }).waitFor()
      assert.equal(await card().getByText(await label(page, 'setting__plugins_removed'), { exact: true }).count(), 0)
      assert.equal(await status(page).innerText(), await label(page, 'setting__plugins_import_success'))
      await version('1.0.0')
      const confirmation = await app.evaluate(() => global.__transferDialogs.confirmations.at(-1))
      assert.match(confirmation.message, /离线测试插件.*v1\.0\.0/)
      assert.ok(confirmation.detail.includes(id))
      assert.ok(confirmation.detail.includes('本机文件'))
      assert.equal(confirmation.defaultId, confirmation.cancelId)
      assert.equal(await app.evaluate(() => global.__pluginRequests.length), requests)
    })
    await t.test('export includes assets and licenses, excludes settings, and supports cancellation', async() => {
      const storage = await app.evaluate(() => global.lxDataPath)
      assert.ok(path.resolve(storage).toLowerCase().startsWith(path.resolve(profilePath).toLowerCase() + path.sep))
      const preferences = path.join(storage, 'plugins/preferences')
      await fs.mkdir(preferences, { recursive: true })
      await fs.writeFile(path.join(preferences, id + '.json'), '{"private":"kept locally"}')
      await choose(app, { destination: null })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      assert.equal(await status(page).count(), 0)
      await choose(app, { destination: backup.slice(0, -'.zip'.length) })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      assert.equal(await status(page).getAttribute('role'), 'status')
      const archive = await unpackSource(await fs.readFile(backup))
      assert.deepEqual(await fs.readFile(backup), await fs.readFile(filename))
      assert.equal(archive.files.size, 3)
      const saveOptions = await app.evaluate(() => global.__transferDialogs.saveOptions)
      assert.equal(saveOptions.defaultPath, `${id}-1.0.0.zip`)
      assert.deepEqual(saveOptions.filters[0].extensions, ['zip'])
    })
    await t.test('replacement can be cancelled and confirmed without restarting', async() => {
      const pid = app.process().pid
      await prepare('1.1.0')
      await choose(app, { response: 1 })
      await importChosen()
      await version('1.0.0')
      const confirmation = await app.evaluate(() => global.__transferDialogs.confirmations.at(-1))
      assert.match(confirmation.message, /v1\.0\.0.*v1\.1\.0/)
      await choose(app, { response: 0 })
      await importChosen()
      await version('1.1.0')
      assert.equal(app.process().pid, pid)
      assert.deepEqual(await page.evaluate(() => window.__transferEvents), ['activate:1.0.0', 'deactivate:1.0.0', 'activate:1.1.0'])
    })
    await t.test('downgrades are explicit and same-version imports reload cleanly', async() => {
      await choose(app, { incoming: backup })
      await importChosen()
      await version('1.0.0')
      assert.match(await app.evaluate(() => global.__transferDialogs.confirmations.at(-1).message), /降级到 v1\.0\.0/)
      await importChosen()
      await version('1.0.0')
      assert.match(await app.evaluate(() => global.__transferDialogs.confirmations.at(-1).message), /v1\.0\.0.*v1\.0\.0/)
    })
    await t.test('bad packages and future APIs report errors and leave the running plugin intact', async() => {
      const confirmations = await app.evaluate(() => global.__transferDialogs.confirmations.length)
      const legacy = path.join(profilePath, 'legacy.lxplugin')
      await fs.writeFile(legacy, 'broken compiled package')
      await choose(app, { incoming: legacy })
      await importChosen()
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_invalid_package')))
      assert.match(await status(page).innerText(), /错误代码|Error code/)
      await fs.writeFile(filename, 'broken')
      await choose(app, { incoming: filename })
      await importChosen()
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_invalid_package')))
      await prepare('2.0.0', 99)
      await importChosen()
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_incompatible')))
      await choose(app, { incoming: path.join(profilePath, 'missing.zip') })
      await importChosen()
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_read_failed')))
      assert.equal(await app.evaluate(() => global.__transferDialogs.confirmations.length), confirmations)
      await version('1.0.0')
    })
    await t.test('export refuses the old extension without creating a backup', async() => {
      const destination = path.join(profilePath, 'no-legacy-export.lxplugin')
      await choose(app, { destination })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_invalid_destination')))
      await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
    })
    await t.test('a concurrent uninstall invalidates the outstanding confirmation', async() => {
      await prepare('1.1.0')
      await choose(app, { waiting: true })
      await click(page, 'setting__plugins_import')
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.disabled && button.textContent === window.i18n.t('setting__plugins_export')))
      // Modify the installation only after the preview has captured the old version.
      for (let i = 0; i < 50; i++) {
        if (await app.evaluate(() => !!global.__finishTransferConfirmation)) break
        await page.waitForTimeout(20)
      }
      assert.equal(await app.evaluate(() => !!global.__finishTransferConfirmation), true)
      await page.evaluate(async id => { await require('electron').ipcRenderer.invoke('optional_plugins:uninstall', id) }, id)
      await app.evaluate(() => {
        global.__finishTransferConfirmation({ response: 0 })
        global.__transferDialogs.waiting = false
      })
      await idle(page)
      assert.ok((await status(page).innerText()).includes(await label(page, 'setting__plugins_transfer_changed')))
      assert.equal(await card().count(), 0)
      await importChosen()
      await version('1.1.0')
    })
    await t.test('small windows keep both transfer controls inside the store', async() => {
      const window = await app.browserWindow(page)
      await window.evaluate(window => window.setContentSize(828, 530))
      await window.dispose()
      await settled(page)
      const bounds = await page.evaluate(() => {
        const card = document.querySelector('[data-plugin-id]')
        return { viewport: window.innerWidth, card: card.getBoundingClientRect().right, buttons: [...card.querySelectorAll('button')].map(button => button.getBoundingClientRect().right) }
      })
      assert.ok(bounds.card <= bounds.viewport)
      assert.ok(bounds.buttons.every(right => right <= bounds.card))
      await page.screenshot({ path: path.join(profilePath, 'plugin-transfer-store.png') })
    })
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(10000)
    await mockGitHub(app, true)
    await mockDialogs(app)
    await openStore(page)
    await t.test('offline restart retains the plugin and export still works', async() => {
      await version('1.1.0')
      await choose(app, { destination: path.join(profilePath, 'restarted.zip') })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      const archive = await unpackSource(await fs.readFile(path.join(profilePath, 'restarted.zip')))
      assert.equal(archive.manifest.version, '1.1.0')
      const storage = await app.evaluate(() => global.lxDataPath)
      assert.equal(await fs.readFile(path.join(storage, 'plugins/preferences', id + '.json'), 'utf8'), '{"private":"kept locally"}')
    })
    assert.deepEqual(fixture.errors, [])
  } catch (error) {
    console.error('Plugin transfer test profile:', profilePath)
    console.error('Transfer status:', await status(page).allTextContents().catch(() => []))
    throw error
  } finally { if (fixture) await fixture.app.close() }
})
