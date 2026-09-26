const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install } = require('./helpers/plugin-fixture.cjs')
const { dragWindow, nativeHitTest } = require('./helpers/native-window-drag.cjs')

test('Folia keeps the player window movable when its controls auto-hide', { timeout: 90000 }, async() => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  try {
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await showDetail(page, true)
    await settled(page)
    await page.locator('[data-folia-stage="player"]').waitFor()
    // Older hosts do not supply their own drag strip. The plugin must work
    // after that host-only element is absent.
    await page.locator('[data-detail-window-drag]').evaluate(element => element.remove())
    const drag = '[data-folia-window-drag]'
    await page.locator(drag).waitFor()
    await page.mouse.move(10, 200)
    await page.waitForTimeout(600)
    if (process.platform === 'win32') assert.equal(await nativeHitTest(app, page, drag, { x: 50, y: 12 }), 2)
    const moved = await dragWindow(app, page, drag, { position: { x: 50, y: 12 } })
    if (process.platform === 'win32') {
      assert.equal(moved.x, moved.expectedX)
      assert.equal(moved.y, moved.expectedY)
      assert.equal(moved.width, moved.expectedWidth)
      assert.equal(moved.height, moved.expectedHeight)
    }
    await page.locator('[data-player-detail]').evaluate(element => element.classList.add('fullscreen'))
    assert.equal(await page.locator(drag).isVisible(), false)
    await page.locator('[data-player-detail]').evaluate(element => element.classList.remove('fullscreen'))
    assert.equal(await page.locator(drag).isVisible(), true)
    await page.evaluate(() => document.documentElement.classList.add('maximized'))
    assert.equal(await page.locator(drag).isVisible(), false)
    await page.evaluate(() => document.documentElement.classList.remove('maximized'))
    assert.equal(await page.locator(drag).isVisible(), true)
    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
