const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label } = require('./helpers/plugin-fixture.cjs')

test('toolkit and optional ZIPs import offline while legacy built-in packages stay built-in', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page, output } = fixture
  app.on('console', message => { if (message.type() === 'error') console.error('Plugin import:', message.text()) })
  const id = 'devkit-independent-example'
  const kit = path.join(output, 'independent-toolkit')
  const source = path.join(output, id)
  const execute = promisify(execFile)
  const run = (...args) => execute(process.execPath, [path.join(kit, 'lx-plugin.cjs'), ...args], {
    cwd: output, windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  })
  const card = id => page.locator(`[data-plugin-id="${id}"]`)
  const button = async key => page.getByRole('button', { name: await label(page, key), exact: true })
  const importFile = async(filename, id) => {
    await app.evaluate((_electron, filename) => { global.__devkitImport = filename }, filename)
    await (await button('setting__plugins_import')).click()
    await (await button('setting__plugins_import')).waitFor({ timeout: 120000 })
    const status = await page.locator('[data-plugin-transfer-status]').innerText()
    if (['sound-effects', 'audio-tag-editor'].includes(id)) {
      assert.equal(status, await label(page, 'setting__plugins_transfer_builtin'))
      assert.equal(await card(id).locator('[data-plugin-status]').innerText(), '自带')
      return
    }
    assert.equal(status, await label(page, 'setting__plugins_import_success'))
    await card(id).getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true })
      .or(card(id).getByRole('button', { name: await label(page, 'setting__plugins_close_settings'), exact: true })).waitFor({ timeout: 20000 })
    const installed = await page.evaluate(async id => (await require('electron').ipcRenderer.invoke('optional_plugins:list')).installed[id], id)
    assert.equal(installed.format, 'zip')
    assert.equal(installed.source, 'local')
  }
  try {
    page.setDefaultTimeout(15000)
    await fs.cp(path.resolve('plugins/developer-kit'), kit, { recursive: true })
    await run('init', source)
    await run('pack', source)
    await mockGitHub(app, true)
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [global.__devkitImport] })
      dialog.showMessageBox = async() => ({ response: 0 })
      process.env.PATH = ''
    })
    await openStore(page)
    await t.test('an unknown toolkit plugin appears and its Vue component responds', async() => {
      await importFile(source + '.zip', id)
      await card(id).getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      await page.getByRole('button', { name: '点击次数：0', exact: true }).click()
      await page.getByRole('button', { name: '点击次数：1', exact: true }).waitFor()
    })
    await t.test('editing and repacking refreshes the plugin without restarting the host', async() => {
      const pid = app.process().pid
      const component = path.join(source, 'src/Settings.vue')
      await fs.writeFile(component, (await fs.readFile(component, 'utf8')).replace('点击次数', '工具包计数'))
      await run('pack', source)
      await importFile(source + '.zip', id)
      await page.getByRole('button', { name: '工具包计数：0', exact: true }).waitFor()
      assert.equal(app.process().pid, pid)
    })
    const examples = require('../plugins/development-examples/index.json')
    for (const example of examples.plugins) {
      await t.test(example.id, () => importFile(path.resolve('plugins/development-examples', example.file), example.id))
    }
    assert.deepEqual(fixture.errors, [])
    assert.equal((await app.evaluate(() => global.__pluginRequests)).every(url => url.endsWith('/catalog.json')), true)
  } catch (error) {
    console.error('Toolkit import profile:', output)
    console.error('Toolkit import status:', await page.locator('[data-plugin-transfer-status]').allTextContents().catch(() => []))
    throw error
  } finally { await app.close() }
})
