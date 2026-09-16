const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, startSilentAudio } = require('./helpers/plugin-fixture.cjs')
const { packSource } = require('../src/common/pluginSource')
const { version: visualizerVersion } = require('../src/optional-plugins/audio-visualizer/plugin.json')

const styles = ['spectrum', 'wave', 'radial']
const showPlayer = async page => {
  await seedTrack(page)
  await page.evaluate(() => {
    window.lxData.musicInfo.lrc = '[00:00.00]Visualizer check\n[00:01.00]Test signal'
    window.app_event.lyricUpdated()
  })
  await showDetail(page, true)
  await settled(page)
}
const openPicker = async page => {
  await page.locator('[data-player-detail]').getByRole('button', { name: await label(page, 'audio_visualization'), exact: true }).click()
  await page.locator('[data-visualizer-dialog]').waitFor()
  await page.waitForFunction(() => document.querySelector('[data-visualizer-dialog]')?.contains(document.activeElement))
  return page.locator('[data-visualizer-dialog]')
}
const choose = async(dialog, style) => {
  await dialog.locator(`[data-visualizer-option="${style}"]`).click()
  await dialog.locator(`[data-visualizer-option="${style}"] input`).waitFor()
  await dialog.page().waitForFunction(style => document.querySelector(`[data-visualizer-dialog] [data-visualizer-option="${style}"] input`)?.checked, style)
  await dialog.page().waitForFunction(() => !document.querySelector('[data-visualizer-dialog] input[type="radio"]')?.disabled)
}
const hasPixels = async(page, selector) => page.waitForFunction(selector => {
  const canvas = document.querySelector(selector)
  return canvas?.width > 0 && canvas.height > 0 && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)
}, selector)

test('visualizer updates independently with three styles and audioMotion, a picker, saved choices and released previews', { timeout: 120000 }, async() => {
  let fixture = await launch()
  const output = fixture.output
  try {
    let { app, page } = fixture
    page.setDefaultTimeout(12000)
    await mockGitHub(app)
    const archive = await packSource({ id: 'audio-visualizer', version: '1.1.1', apiVersion: 1, entry: 'src/index.js' }, new Map([
      ['src/index.js', Buffer.from("import { h } from 'vue'; export default { components: { Settings: () => h('div', 'Previous source version') } }")],
    ]))
    const sha256 = createHash('sha256').update(archive).digest('hex')
    const oldCatalog = { schemaVersion: 2, plugins: [{ id: 'audio-visualizer', version: '1.1.1', apiVersion: 1, path: `audio-visualizer/1.1.1/${sha256}.zip`, bytes: archive.length, sha256 }] }
    await app.evaluate((_electron, { catalog, archive }) => {
      global.__pluginCatalogOverride = catalog
      global.__pluginPackageOverrides[catalog.plugins[0].path] = archive
    }, { catalog: oldCatalog, archive: archive.toString('base64') })
    await openStore(page)
    await install(page, 'audio-visualizer')
    const dataRoot = await app.evaluate(() => global.lxDataPath)
    const oldRegistry = JSON.parse(await fs.readFile(path.join(dataRoot, 'plugins/installed.json'), 'utf8'))
    assert.equal(oldRegistry['audio-visualizer'] != null, true)
    await fs.mkdir(path.join(dataRoot, 'plugins/preferences'), { recursive: true })
    await fs.writeFile(path.join(dataRoot, 'plugins/preferences/audio-visualizer.json'), JSON.stringify({ version: 1, main: 'bars', desktop: 'ring' }))
    await app.evaluate(() => { global.__pluginCatalogOverride = null })
    await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).click()
    await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_update'), exact: true }).click()
    await page.waitForFunction(version => document.querySelector('[data-plugin-id="audio-visualizer"]')?.textContent.includes(`v${version}`), visualizerVersion)
    await assert.rejects(fs.stat(path.join(dataRoot, 'plugins', oldRegistry['audio-visualizer'].directory)), { code: 'ENOENT' })
    await page.evaluate(() => {
      window.__visualizerAnalysers = []
      const connect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function(target, ...args) {
        if (target instanceof AudioDestinationNode) {
          const silence = this.context.createGain()
          silence.gain.value = 0
          connect.call(silence, target)
          return connect.call(this, silence, ...args)
        }
        return connect.call(this, target, ...args)
      }
      const create = AudioContext.prototype.createAnalyser
      AudioContext.prototype.createAnalyser = function() {
        const analyser = create.call(this)
        const disconnect = analyser.disconnect.bind(analyser)
        analyser.__disconnected = false
        analyser.disconnect = (...args) => { analyser.__disconnected = true; return disconnect(...args) }
        window.__visualizerAnalysers.push(analyser)
        return analyser
      }
    })
    await showPlayer(page)
    let dialog = await openPicker(page)
    assert.equal(await dialog.getByRole('radio').count(), 3)
    assert.equal(await dialog.locator('[data-visualizer-option="spectrum"] input').isChecked(), true, 'Removed bars style falls back to spectrum')
    await dialog.locator('[data-visualizer-surface="desktop"]').click()
    assert.equal(await dialog.locator('[data-visualizer-option="radial"] input').isChecked(), true, 'Old ring migrates to audioMotion')
    await dialog.locator('[data-visualizer-surface="main"]').click()
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.audioVisualization']), false, 'Opening the picker does not toggle the visualizer')
    for (const kind of styles) await hasPixels(page, `[data-visualizer-dialog] [data-visualizer-option="${kind}"] canvas`)
    const previews = await dialog.locator('[data-visualizer-option] canvas').evaluateAll(canvases => canvases.map(canvas => canvas.toDataURL()))
    assert.equal(new Set(previews).size, 3, 'Each style has a distinct preview')
    for (const [width, height] of [[828, 540], [1366, 768], [3840, 2160]]) {
      await page.setViewportSize({ width, height })
      await settled(page)
      const box = await dialog.boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, JSON.stringify(box))
      for (const kind of styles) {
        await dialog.locator(`[data-visualizer-option="${kind}"]`).scrollIntoViewIfNeeded()
        const card = await dialog.locator(`[data-visualizer-option="${kind}"]`).boundingBox()
        assert.ok(card.x >= box.x && card.x + card.width <= box.x + box.width + 1)
      }
      if (width === 828) await page.screenshot({ path: path.join(output, 'visualizer-picker-small.png') })
    }
    await page.setViewportSize({ width: 1114, height: 718 })
    await dialog.locator('[data-visualizer-option="spectrum"] input').focus()
    await page.keyboard.press('ArrowRight')
    await page.locator('[data-plugin-visualizer="main"][data-visualizer-style="wave"]').waitFor()
    await choose(dialog, 'wave')
    await page.locator('[data-plugin-visualizer="main"][data-visualizer-style="wave"]').waitFor()
    await page.screenshot({ path: path.join(output, 'visualizer-picker.png') })
    await dialog.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.locator('[data-player-detail] button[aria-haspopup="dialog"]').evaluate(button => button === document.activeElement), true)
    await startSilentAudio(page)
    await hasPixels(page, '[data-plugin-visualizer="main"] canvas')
    dialog = await openPicker(page)
    for (const kind of styles) {
      await choose(dialog, kind)
      await page.locator(`[data-plugin-visualizer="main"][data-visualizer-style="${kind}"]`).waitFor()
      await hasPixels(page, '[data-plugin-visualizer="main"] canvas')
      if (kind === 'radial') {
        assert.equal(await page.locator('[data-plugin-visualizer="main"] canvas').getAttribute('data-visualizer-engine'), 'audioMotion-4.5.4')
        assert.equal(await page.evaluate(() => window.__visualizerAnalysers.some(node => node.fftSize === 8192 && !node.__disconnected)), true)
      }
    }
    await choose(dialog, 'wave')
    await dialog.locator('[data-visualizer-surface="desktop"]').click()
    await choose(dialog, 'radial')
    assert.equal(await page.locator('[data-plugin-visualizer="main"]').getAttribute('data-visualizer-style'), 'wave')
    await page.evaluate(() => window.lxData.updateSetting({ 'desktopLyric.enable': true }))
    const desktop = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    await desktop.locator('[data-plugin-visualizer="desktop"][data-visualizer-style="radial"]').waitFor({ timeout: 20000 })
    await hasPixels(desktop, '[data-plugin-visualizer="desktop"] canvas')
    for (const kind of styles) {
      await choose(dialog, kind)
      await desktop.locator(`[data-plugin-visualizer="desktop"][data-visualizer-style="${kind}"]`).waitFor()
      await hasPixels(desktop, '[data-plugin-visualizer="desktop"] canvas')
    }
    await choose(dialog, 'radial')
    await page.evaluate(() => window.lxData.updateSetting({ 'player.audioVisualization': false, 'desktopLyric.audioVisualization': false, 'desktopLyric.enable': false }))
    await dialog.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => window.__visualizerAnalysers.every(analyser => analyser.__disconnected))
    assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), false)
    dialog = await openPicker(page)
    await hasPixels(page, '[data-visualizer-dialog] [data-visualizer-preview="wave"]')
    const oldCount = await page.evaluate(() => window.__visualizerAnalysers.length)
    assert.ok(oldCount >= 2, 'A new preview analyser is created after the previous one was released')
    await page.evaluate(() => require('electron').ipcRenderer.invoke('optional_plugins:uninstall', 'audio-visualizer'))
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__visualizerAnalysers.every(analyser => analyser.__disconnected)), true)
    const preferencesFile = path.join(dataRoot, 'plugins/preferences/audio-visualizer.json')
    assert.deepEqual(JSON.parse(await fs.readFile(preferencesFile, 'utf8')), { version: 1, main: 'wave', desktop: 'radial' })
    await page.evaluate(() => window.__lxPluginHost.player.setStop())
    await showDetail(page, false)
    await openStore(page)
    await install(page, 'audio-visualizer')
    await route(page, '/search')
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = await launch({ profilePath: output })
    ;({ app, page } = fixture)
    page.setDefaultTimeout(12000)
    await mockGitHub(app, true)
    await showPlayer(page)
    dialog = await openPicker(page)
    assert.equal(await dialog.locator('[data-visualizer-option="wave"] input').isChecked(), true)
    await dialog.locator('[data-visualizer-surface="desktop"]').click()
    assert.equal(await dialog.locator('[data-visualizer-option="radial"] input').isChecked(), true)
    await page.evaluate(() => window.lxData.updateSetting({ 'common.langId': 'en-us' }))
    await dialog.getByRole('radio', { name: 'Radial spectrum', exact: true }).waitFor()
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual(fixture.errors, [])
    console.log('Visualizer upgrade verified:', output)
  } catch (error) {
    console.error('Visualizer test profile:', output, 'Renderer errors:', fixture.errors)
    console.error('Focus:', await fixture.page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 500), dialog: document.querySelector('[data-visualizer-dialog]')?.getAttribute('tabindex') })).catch(() => null))
    await fixture.page.screenshot({ path: path.join(output, 'visualizer-failure.png') }).catch(() => {})
    throw error
  } finally { await fixture.app.close() }
})
