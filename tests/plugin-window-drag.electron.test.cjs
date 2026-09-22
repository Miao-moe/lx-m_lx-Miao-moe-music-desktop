const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install } = require('./helpers/plugin-fixture.cjs')
const { nativeHitTest, dragWindow } = require('./helpers/native-window-drag.cjs')

test('installed Folia keeps a native caption drag area and clickable controls on both sides', { timeout: 90000, skip: process.platform !== 'win32' }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page, output } = fixture
  const chrome = '[data-player-detail] [data-detail-part="chrome"]'
  const strip = '[data-detail-window-drag]'
  try {
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await page.locator('[data-folia-stage="player"] iframe').waitFor()
    for (const side of ['right', 'left']) {
      await t.test(`${side} controls stay clickable while hidden chrome still supports native dragging`, async() => {
        await page.evaluate(side => { window.lxData.appSetting['common.controlBtnPosition'] = side }, side)
        await page.mouse.move(500, 300)
        await page.waitForFunction(selector => window.getComputedStyle(document.querySelector(selector)).opacity === '0', chrome)
        assert.equal(await nativeHitTest(app, page, strip, { x: 30, y: 16 }), 2)
        const button = page.locator(chrome + ' button').first()
        const box = await button.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.waitForFunction(selector => window.getComputedStyle(document.querySelector(selector)).opacity === '1', chrome)
        assert.equal(await nativeHitTest(app, page, chrome + ' button', { x: 15, y: 15 }), 1)
        await button.click()
        await page.locator(strip).waitFor({ state: 'hidden' })
        assert.equal(await page.locator(strip).isVisible(), false)
        await showDetail(page, true)
        await settled(page)
      })
    }
    await t.test('the Windows window moves without resizing through the caption region', async() => {
      const result = await dragWindow(app, page, strip)
      assert.equal(result.width, result.expectedWidth)
      assert.equal(result.height, result.expectedHeight)
      assert(Math.abs(result.x - result.expectedX) < 1)
      assert(Math.abs(result.y - result.expectedY) < 1)
    })
    await t.test('maximized and fullscreen modes remove the floating drag strip', async() => {
      await page.evaluate(() => window.__motionDetail().max())
      await page.locator(strip).waitFor({ state: 'detached' })
      await page.evaluate(() => window.__motionDetail().max())
      await page.locator(strip).waitFor()
      await page.evaluate(() => require('electron').ipcRenderer.invoke('winMain_fullscreen', true))
      await page.locator(strip).waitFor({ state: 'detached' })
      await page.evaluate(() => require('electron').ipcRenderer.invoke('winMain_fullscreen', false))
      await page.locator(strip).waitFor()
    })
    assert.deepEqual(fixture.errors, [])
    await page.screenshot({ path: path.join(output, 'folia-window-drag.png') })
    console.log('Folia native drag evidence:', output)
  } finally { await app.close() }
})
