const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, showDetail, seedLyrics, seedTrack } = require('./helpers/motion-fixture.cjs')
const { startSilentAudio } = require('./helpers/plugin-fixture.cjs')

test('controls visibly follow moving local artwork, reuse sampling, and restore cleanly', { timeout: 120000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-backgrounding-occluded-windows'] })
  const { app, page, output } = fixture
  page.setDefaultTimeout(10000)
  const update = settings => page.evaluate(settings => window.lxData.updateSetting(settings), settings)
  const search = () => page.getByRole('textbox', { name: '搜索设置项', exact: true })
  const background = '[data-ambient-background="shared"]'
  const controls = '#left a[role="tab"], #toolbar button, #player button, #view [role="checkbox"]'
  const read = () => page.locator(controls).evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height).map(element => ({
    label: element.getAttribute('aria-label'), zone: element.dataset.ambientZone,
    color: getComputedStyle(element).color, accent: getComputedStyle(element).getPropertyValue('--color-button-font').trim(),
  })))
  try {
    await update({ 'common.langId': 'zh-cn', 'ui.ambientBackground': true, 'ui.ambientBackgroundAutoContrast': true, 'ui.ambientBackgroundQuality': 'full', 'common.isShowAnimation': true })
    await route(page, '/setting?name=SettingAdvanced')
    await settled(page)
    await seedTrack(page)
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fb4662"/><stop offset=".30" stop-color="#ffba38"/><stop offset=".50" stop-color="#20bfbe"/><stop offset=".73" stop-color="#4772ec"/><stop offset="1" stop-color="#b744cc"/></linearGradient></defs><rect width="600" height="600" fill="url(#a)"/><circle cx="110" cy="460" r="110" fill="#18cda8"/><circle cx="480" cy="120" r="80" fill="#ee405e"/></svg>'
      window.lxData.musicInfo.pic = 'data:image/svg+xml,' + encodeURIComponent(svg)
      window.lxData.musicInfo.lrc = '[00:00.00]Local background color check\n[00:01.00]Colors follow the flow'
      window.app_event.lyricUpdated()
      window.__regionSamples = 0
      const read = CanvasRenderingContext2D.prototype.getImageData
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        if (this.canvas.width === 24 && this.canvas.height === 16) window.__regionSamples++
        return read.apply(this, args)
      }
      window.__regionCanvas = document.querySelector('[data-ambient-background] canvas')
    })
    await startSilentAudio(page)
    await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().muted = true })
    await page.waitForFunction(selector => document.querySelector(selector).dataset.ambientState === 'playing', background)
    await page.locator('#left [data-ambient-zone]').first().waitFor()

    await t.test('one unchanged multi-color cover produces different local button colors and visible changes over time', async() => {
      await page.waitForTimeout(1500)
      const samples = [await read()]
      const originalCover = await page.evaluate(() => window.lxData.musicInfo.pic)
      await page.screenshot({ path: path.join(output, 'local-colors-start.png') })
      const before = await page.evaluate(() => window.__regionSamples)
      for (let index = 0; index < 6; index++) {
        await page.waitForTimeout(1000)
        samples.push(await read())
      }
      const count = await page.evaluate(() => window.__regionSamples) - before
      assert(count >= 10 && count <= 35, `shared samples in six seconds: ${count}`)
      assert.equal(await page.evaluate(() => window.lxData.musicInfo.pic), originalCover)
      assert(new Set(samples[0].map(item => item.accent)).size > 3, 'different screen areas should follow their own colors')
      const rgb = color => color.match(/[\d.]+/g).map(Number)
      const differences = samples[0].map((item, index) => Math.max(...samples.slice(1).map(sample => Math.max(...rgb(sample[index].color).map((value, channel) => Math.abs(value - rgb(item.color)[channel]))))))
      assert(differences.filter(value => value >= 20).length >= 3, `visible changes across controls: ${differences}`)
      await page.screenshot({ path: path.join(output, 'local-colors-moving.png') })
      await fs.writeFile(path.join(output, 'local-colors-samples.json'), JSON.stringify({ count, differences, samples }, null, 2))
    })

    await t.test('scrolling, filtered settings and lyrics bind new controls to the shared regions', async() => {
      await search().fill('背景 按钮')
      await page.locator('label[for="setting_advanced_background_auto_contrast"] [data-ambient-zone]').waitFor()
      await search().press('Escape')
      await page.locator('[data-setting-content]').evaluate(element => { element.scrollTop = element.scrollHeight })
      await page.locator('[data-setting-content] [role="checkbox"][data-ambient-zone]').first().waitFor()
      await showDetail(page, true)
      await settled(page)
      await seedLyrics(page)
      await page.locator('[data-player-detail] button[data-ambient-zone]').first().waitFor()
      await page.locator('[data-player-detail] .font-lrc[data-ambient-zone]').first().waitFor()
      assert.equal(await page.locator(background + ' canvas').evaluate(canvas => canvas === window.__regionCanvas), true)
      await showDetail(page, false)
      await settled(page)
    })

    await t.test('pause stops continuous color sampling and disabling restores all local overrides', async() => {
      await page.evaluate(() => window.__lxPluginHost.player.setPause())
      await page.waitForFunction(selector => document.querySelector(selector).dataset.ambientState === 'static', background)
      const before = await page.evaluate(() => window.__regionSamples)
      await page.waitForTimeout(600)
      assert.equal(await page.evaluate(() => window.__regionSamples), before)
      await update({ 'ui.ambientBackgroundAutoContrast': false })
      await page.locator('#root[data-ambient-controls]').waitFor({ state: 'detached' })
      assert.equal(await page.locator('[data-ambient-zone]').count(), 0)
      assert.equal(await page.locator('[style*="--ambient-local-"]').count(), 0)
      assert.equal(await page.locator('#root').evaluate(element => element.style.cssText.includes('--ambient-zone-')), false)
      await update({ 'ui.ambientBackgroundAutoContrast': true })
      await page.locator('#left [data-ambient-zone]').first().waitFor()
      await update({ 'ui.ambientBackground': false })
      await page.locator(background).waitFor({ state: 'detached' })
      assert.equal(await page.locator('[data-ambient-zone]').count(), 0)
      assert.equal(await page.locator('[style*="--ambient-local-"]').count(), 0)
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Local background color previews:', output)
  } finally { await app.close() }
})
