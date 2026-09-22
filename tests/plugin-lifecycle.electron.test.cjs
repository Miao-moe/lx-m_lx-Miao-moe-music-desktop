const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { packPlugin } = require('../src/common/pluginPackage')
const { launch } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label } = require('./helpers/plugin-fixture.cjs')

const id = 'lifecycle-fixture', otherId = 'lifecycle-other'
const snapshot = page => page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:list'))
async function poll(read, predicate) {
  const start = Date.now()
  while (!predicate(await read())) {
    if (Date.now() - start > 10000) throw Error('Plugin lifecycle did not settle')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
function plugin(id, version, { fail = false, lyricFail = false, cleanupFail = false } = {}) {
  const module = lyric => `const {vue}=window.__lxPluginHost;const helper=require('./helper.js');
    window.__lifecycleEvents??=[];window.__lifecycleEvents.push('${id}:${version}:${lyric ? 'lyric' : 'main'}:module');
    ${lyric && lyricFail ? "throw Error('fixture lyric load failure')" : ''}
    module.exports.default={components:${lyric ? '{}' : `{Settings:{render(){return vue.h('div',{'data-lifecycle-settings':'${id}'},helper.value)}}}`},
    ${lyric ? `slots:{desktopLyricOverlay:{render(){return vue.h('div',{'data-lifecycle-desktop':'${id}'},helper.value)}}},` : ''}
    async activate(){${!lyric && fail ? "throw Error('fixture activation failure');" : ''}
      return async()=>{window.__lifecycleEvents.push('${id}:${version}:dispose');${cleanupFail ? "throw Error('fixture teardown failure')" : ''}}
    }};`
  const files = [
    { path: 'renderer.js', data: Buffer.from(module(false)) },
    { path: 'lyric.js', data: Buffer.from(module(true)) },
    { path: 'helper.js', data: Buffer.from(`module.exports={value:'${version}'}`) },
    { path: 'renderer.css', data: Buffer.from('[data-lifecycle-settings]{padding:8px}') },
  ]
  const hash = bytes => createHash('sha256').update(bytes).digest('hex')
  const manifest = { id, version, apiVersion: 3, name: id, entry: 'renderer.js', lyricEntry: 'lyric.js', styles: ['renderer.css'], files: files.map(file => ({ path: file.path, bytes: file.data.length, sha256: hash(file.data) })) }
  const bytes = packPlugin(manifest, files)
  return { entry: { id, version, apiVersion: 3, name: id, path: `${id}/${version}/${hash(bytes)}.lxplugin`, bytes: bytes.length, sha256: hash(bytes) }, bytes: bytes.toString('base64') }
}
const publish = (app, packages) => app.evaluate((_electron, packages) => {
  global.__pluginCatalogOverride = { schemaVersion: 2, plugins: packages.map(item => item.entry) }
  for (const item of packages) global.__pluginPackageOverrides[item.entry.path] = item.bytes
}, packages)

test('Newest plugin only: runtime errors, cross-window disable, cache eviction and preserved settings work in production', { timeout: 120000 }, async t => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = f.output
  const first = plugin(id, '1.0.0', { cleanupFail: true }), other = plugin(otherId, '1.0.0')
  let page = f.page
  const card = () => page.locator(`[data-plugin-id="${id}"]`)
  const button = async(key) => card().getByRole('button', { name: await label(page, key), exact: true }).click()
  try {
    page.setDefaultTimeout(12000)
    await mockGitHub(f.app); await publish(f.app, [first, other]); await openStore(page)
    await button('setting__plugins_install')
    await button('setting__plugins_settings')
    await page.locator(`[data-lifecycle-settings="${id}"]`).waitFor()
    await page.locator(`[data-plugin-id="${otherId}"]`).getByRole('button', { name: await label(page, 'setting__plugins_install'), exact: true }).click()
    await poll(() => snapshot(page), value => Object.keys(value.installed).length === 2)
    let original = (await snapshot(page)).installed[id]
    await page.evaluate(() => window.lxData.updateSetting({ 'player.audioVisualization': true, 'desktopLyric.enable': true, 'desktopLyric.pauseHide': false }))
    const desktop = f.app.windows().find(page => page.url().includes('lyric.html')) ?? await f.app.waitForEvent('window', { predicate: page => page.url().includes('lyric.html') })
    await desktop.locator(`[data-lifecycle-desktop="${id}"]`).waitFor()
    for (const [version, options] of [['1.1.0', { fail: true }], ['1.2.0', { lyricFail: true }]]) {
      await publish(f.app, [plugin(id, version, options), other])
      await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).click()
      await button(version === '1.1.0' ? 'setting__plugins_update' : 'setting__plugins_reinstall')
      await poll(() => snapshot(page), value => value.installed[id]?.manifest.version === version && value.loadFailures[id]?.failedVersion === version)
      await card().getByRole('alert').filter({ hasText: /fixture (activation|lyric load) failure/ }).waitFor()
      assert.match(await card().innerText(), /PLUGIN_LOAD_FAILED|LOAD_FAILED/)
      await assert.rejects(fs.stat(original.directory), { code: 'ENOENT' })
      original = (await snapshot(page)).installed[id]
      assert.equal(await card().locator('[data-plugin-recovery]').count(), 0)
      assert.equal((await snapshot(page)).installed[otherId].manifest.version, '1.0.0')
    }
    await publish(f.app, [plugin(id, '1.3.0'), other])
    await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).click()
    await button('setting__plugins_reinstall')
    await page.waitForFunction(id => document.querySelector(`[data-lifecycle-settings="${id}"]`)?.textContent === '1.3.0', id)
    await desktop.waitForFunction(id => document.querySelector(`[data-lifecycle-desktop="${id}"]`)?.textContent === '1.3.0', id)
    await assert.rejects(fs.stat(original.directory), { code: 'ENOENT' })
    original = (await snapshot(page)).installed[id]
    await button('setting__plugins_disable')
    await card().locator('[data-plugin-status]').getByText(await label(page, 'setting__plugins_disabled'), { exact: true }).waitFor()
    await page.locator(`[data-lifecycle-settings="${id}"]`).waitFor({ state: 'detached' })
    await desktop.locator(`[data-lifecycle-desktop="${id}"]`).waitFor({ state: 'detached' })
    assert.equal(await page.locator(`style[data-plugin="${id}"]`).count(), 0)
    assert.equal(await page.evaluate(directory => Object.keys(require.cache).filter(file => file.startsWith(directory)).length, original.directory), 0)
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), true)
    assert.ok(await fs.stat(original.directory))
    await page.screenshot({ path: path.join(profilePath, 'plugin-disabled.png') })
    assert.deepEqual(f.errors, [])
    await f.app.close(); f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') }); page = f.page
    page.setDefaultTimeout(12000)
    await mockGitHub(f.app, true); await openStore(page)
    assert.equal((await snapshot(page)).installed[id].enabled, false)
    assert.equal(await page.evaluate(id => (window.__lifecycleEvents ?? []).some(event => event.startsWith(id + ':')), id), false)
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), true)
    await button('setting__plugins_enable'); await button('setting__plugins_settings')
    await page.locator(`[data-lifecycle-settings="${id}"]`).waitFor()
    assert.equal(await page.locator(`[data-lifecycle-settings="${id}"]`).innerText(), '1.3.0')
    await button('setting__plugins_uninstall')
    await poll(() => snapshot(page), value => !value.installed[id] && !value.sources?.[id])
    await assert.rejects(fs.stat(original.directory), { code: 'ENOENT' })
    assert.ok((await snapshot(page)).installed[otherId])
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), true)
    assert.deepEqual(f.errors, [])
    t.diagnostic('Plugin lifecycle screenshots: ' + profilePath)
  } catch (error) {
    await page.screenshot({ path: path.join(profilePath, 'plugin-lifecycle-failure.png'), timeout: 2000 }).catch(() => {})
    t.diagnostic(JSON.stringify({ profilePath, errors: f.errors, state: await snapshot(page).catch(() => null), cards: await page.locator('[data-plugin-id]').allTextContents().catch(() => []) }))
    throw error
  } finally { await f.app.close() }
})
