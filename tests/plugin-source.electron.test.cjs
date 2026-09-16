const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { packSource, unpackSource } = require('../src/common/pluginSource')
const { launch } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install } = require('./helpers/plugin-fixture.cjs')

const id = 'source-ui-test'
const sourcePackage = (version, broken = false) => packSource({ id, version, apiVersion: 3, entry: 'src/index.ts', name: '源码编译测试' }, new Map([
  ['src/index.ts', Buffer.from(broken ? 'export default =' : "import Settings from './Settings.vue'; export default { components: { Settings } }")],
  ['src/Settings.vue', Buffer.from(`<template><div class="source-example"><p data-source-version>${version}</p><button @click="count++">源码计数 {{ count }}</button></div></template><script setup lang="ts">import { ref } from 'vue'; const count = ref<number>(0);</script><style scoped lang="less">.source-example { padding: 16px; p { color: rgb(12, 123, 45); } }</style>`)],
  ['LICENSE', Buffer.from('Source test license')],
]))
const dialogs = app => app.evaluate(({ dialog }) => {
  global.__sourceTransfer = { filename: null, destination: null, response: 0 }
  dialog.showOpenDialog = async() => ({ canceled: !global.__sourceTransfer.filename, filePaths: global.__sourceTransfer.filename ? [global.__sourceTransfer.filename] : [] })
  dialog.showSaveDialog = async(_window, options) => {
    global.__sourceTransfer.save = options
    return { canceled: !global.__sourceTransfer.destination, filePath: global.__sourceTransfer.destination }
  }
  dialog.showMessageBox = async() => ({ response: global.__sourceTransfer.response })
  // Import uses Electron's embedded Node, not a node/npm executable on PATH.
  process.env.PATH = ''
})
const choose = (app, values) => app.evaluate((_electron, values) => Object.assign(global.__sourceTransfer, values), values)
const click = async(page, key, scope = page) => scope.getByRole('button', { name: await label(page, key), exact: true }).click()
const idle = async page => page.getByRole('button', { name: await label(page, 'setting__plugins_import'), exact: true }).waitFor()

test('source ZIP import compiles Vue offline, exports only source, rolls back errors and restarts offline', { timeout: 90000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const filename = path.join(profilePath, 'source.zip')
  const exported = path.join(profilePath, 'export.zip')
  const card = () => page.locator(`[data-plugin-id="${id}"]`)
  const status = () => page.locator('[data-plugin-transfer-status]')
  const prepare = async(version, broken) => {
    await fs.writeFile(filename, await sourcePackage(version, broken))
    await choose(app, { filename, response: 0 })
  }
  const showSettings = async version => {
    const settings = card().getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true })
    if (await settings.count()) await settings.click()
    await page.waitForFunction(version => document.querySelector('[data-source-version]')?.textContent === version, version)
  }
  try {
    page.setDefaultTimeout(15000)
    await mockGitHub(app, true)
    await dialogs(app)
    await openStore(page)
    await t.test('confirmation cancellation does not build or install anything', async() => {
      await prepare('1.0.0')
      await choose(app, { response: 1 })
      await click(page, 'setting__plugins_import')
      await idle(page)
      assert.equal(await card().count(), 0)
    })
    await t.test('a real Vue/TypeScript/Less package compiles with the app still responsive', async() => {
      await choose(app, { response: 0 })
      await click(page, 'setting__plugins_import')
      await page.getByText(await label(page, 'setting__plugins_compiling'), { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.querySelector('#container') !== null), true)
      await idle(page)
      assert.equal(await status().innerText(), await label(page, 'setting__plugins_import_success'))
      await showSettings('1.0.0')
      assert.equal(await page.locator('[data-source-version]').evaluate(node => getComputedStyle(node).color), 'rgb(12, 123, 45)')
      await page.getByRole('button', { name: '源码计数 0', exact: true }).click()
      await page.getByRole('button', { name: '源码计数 1', exact: true }).waitFor()
    })
    await t.test('export preserves the original source ZIP without compiled artifacts', async() => {
      await choose(app, { destination: exported })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      assert.deepEqual(await fs.readFile(exported), await fs.readFile(filename))
      const source = await unpackSource(await fs.readFile(exported))
      assert.ok(source.files.has('src/Settings.vue'))
      assert.equal(source.files.has('renderer.js'), false)
      assert.deepEqual(await app.evaluate(() => global.__sourceTransfer.save.filters[0].extensions), ['zip'])
    })
    await t.test('compiler errors keep the installed code and source backup', async() => {
      await prepare('1.1.0', true)
      await click(page, 'setting__plugins_import')
      await idle(page)
      assert.equal(await status().getAttribute('role'), 'alert')
      assert.ok((await status().innerText()).includes(await label(page, 'setting__plugins_transfer_compile_failed')))
      await showSettings('1.0.0')
      await choose(app, { destination: exported })
      await click(page, 'setting__plugins_export', card())
      await idle(page)
      assert.equal((await unpackSource(await fs.readFile(exported))).manifest.version, '1.0.0')
    })
    await t.test('source replacement reloads code without restarting the application', async() => {
      const pid = app.process().pid
      await prepare('1.1.0')
      await click(page, 'setting__plugins_import')
      await idle(page)
      await showSettings('1.1.0')
      assert.equal(app.process().pid, pid)
      const leftovers = await app.evaluate(async() => {
        const fs = process.mainModule.require('node:fs/promises')
        const path = process.mainModule.require('node:path')
        return (await fs.readdir(path.join(global.lxDataPath, 'plugins'))).filter(name => /^source-[a-f0-9]{8}-/.test(name))
      })
      assert.deepEqual(leftovers, [])
    })
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(15000)
    await mockGitHub(app, true)
    await dialogs(app)
    await openStore(page)
    await t.test('restart loads the compiled installation offline', async() => {
      await showSettings('1.1.0')
      assert.equal(await status().count(), 0)
    })
    assert.deepEqual(fixture.errors, [])
  } catch (error) {
    console.error('Source import profile:', profilePath)
    console.error('Source import status:', await status().allTextContents().catch(() => []))
    throw error
  } finally { if (fixture) await fixture.app.close() }
})

test('an installation without its source record requires reinstall and then exports ZIP', { timeout: 45000 }, async() => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  const catalog = require('../plugins/store/catalog.json')
  const official = catalog.plugins.find(plugin => plugin.id === 'audio-tag-editor')
  const card = page.locator(`[data-plugin-id="${official.id}"]`)
  const destination = path.join(fixture.output, 'official-source.zip')
  try {
    page.setDefaultTimeout(15000)
    await mockGitHub(app)
    await dialogs(app)
    await openStore(page)
    await install(page, official.id)
    const installedPaths = await app.evaluate(async(_electron, id) => {
      const fs = process.mainModule.require('node:fs/promises')
      const path = process.mainModule.require('node:path')
      const root = path.join(global.lxDataPath, 'plugins')
      const registry = JSON.parse(await fs.readFile(path.join(root, 'installed.json'), 'utf8'))
      const directory = path.join(root, registry[id].directory)
      return { files: await fs.readdir(directory), temporary: (await fs.readdir(root)).filter(name => /^(source|install)-/.test(name)) }
    }, official.id)
    assert.equal(installedPaths.files.includes('.source.zip'), false)
    assert.equal(installedPaths.files.includes('.source'), true)
    assert.deepEqual(installedPaths.temporary, [])
    const update = card.getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true })
    assert.equal(await update.count(), 0)
    await app.evaluate(async(_electron, id) => {
      const fs = process.mainModule.require('node:fs/promises')
      const path = process.mainModule.require('node:path')
      const filename = path.join(global.lxDataPath, 'plugins/installed.json')
      const registry = JSON.parse(await fs.readFile(filename, 'utf8'))
      delete registry[id].sourceManifestHash
      await fs.writeFile(filename, JSON.stringify(registry))
    }, official.id)
    await click(page, 'setting__plugins_refresh')
    const reinstall = card.getByRole('button', { name: await label(page, 'setting__plugins_reinstall'), exact: true })
    await reinstall.click()
    await page.getByText(await label(page, 'setting__plugins_compiling'), { exact: true }).waitFor()
    await reinstall.waitFor({ state: 'detached' })
    await choose(app, { destination })
    await click(page, 'setting__plugins_export', card)
    await idle(page)
    const exported = await fs.readFile(destination)
    assert.deepEqual(exported, await fs.readFile(path.join('plugins/store', official.path)))
    assert.equal((await unpackSource(exported)).manifest.version, official.version)
    assert.deepEqual(await app.evaluate(() => global.__sourceTransfer.save.filters[0].extensions), ['zip'])
    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
