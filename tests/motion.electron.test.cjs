// Build the renderer first: npm run build:renderer
// Run: node --test tests/motion.electron.test.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, seedTrack, seedLyrics, route, showDetail, settled } = require('./helpers/motion-fixture.cjs')

const emulateMotion = async(page, reducedMotion) => {
  // Wait for Chromium to dispatch the preference change before checking app motion.
  await page.evaluate(reducedMotion => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    window.__motionMediaReady = media.matches === (reducedMotion === 'reduce')
      ? Promise.resolve()
      : new Promise(resolve => media.addEventListener('change', resolve, { once: true }))
  }, reducedMotion)
  await page.emulateMedia({ reducedMotion })
  await page.evaluate(async() => {
    await window.__motionMediaReady
    await new Promise(resolve => requestAnimationFrame(resolve))
  })
}

test('Fluent motion in the Electron renderer', { timeout: 150000 }, async t => {
  const { app, page, errors, output } = await launch({ args: ['--disable-backgrounding-occluded-windows'] })
  t.diagnostic(`Renderer under test: ${new URL(page.url()).origin}`)
  const geometry = () => page.evaluate(() => Object.fromEntries(['#left', '#toolbar', '#player'].map(selector => {
    const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect()
    return [selector, [x, y, width, height].map(n => Math.round(n * 100) / 100)]
  })))
  try {
    const original = await geometry()
    await t.test('rapid navigation preserves the shell without cloning outgoing lists', async() => {
      await page.evaluate(() => {
        window.__motionCloneCount = 0
        const cloneNode = Node.prototype.cloneNode
        Node.prototype.cloneNode = function(deep) {
          if (this instanceof Element && this.matches('[data-motion-outlet]')) window.__motionCloneCount++
          return cloneNode.call(this, deep)
        }
      })
      await route(page, '/setting')
      await page.waitForFunction(() => document.querySelector('#view > [data-motion-outlet]').getAnimations().length > 0)
      const motion = await page.evaluate(() => ({
        snapshots: document.querySelectorAll('[data-motion-snapshot]').length,
        duration: document.querySelector('#view > [data-motion-outlet]').getAnimations()[0]?.effect.getTiming().duration,
        from: document.querySelector('#view > [data-motion-outlet]').getAnimations()[0]?.effect.getKeyframes()[0].transform,
      }))
      assert.deepEqual(motion, { snapshots: 0, duration: 240, from: 'translateY(24px)' })
      for (let i = 0; i < 30; i++) {
        await route(page, ['/search', '/list', '/setting'][i % 3])
        await page.waitForTimeout(35)
      }
      await settled(page)
      assert.equal(await page.evaluate(() => window.__motionCloneCount), 0)
      assert.deepEqual(await geometry(), original)
      assert.equal(await page.locator('#view > [data-motion-outlet] > .view-container').count(), 1)
    })

    await t.test('settings panels animate without moving their navigation', async() => {
      const tabs = page.locator('#view [role="tab"]')
      const before = await tabs.first().boundingBox()
      for (let i = 0; i < 16; i++) {
        await tabs.nth(i % 4).dispatchEvent('click')
        await page.waitForTimeout(30)
      }
      await settled(page)
      assert.deepEqual(await tabs.first().boundingBox(), before)
      assert.deepEqual(await geometry(), original)
    })

    await t.test('page and settings panel motion work with every list loading mode', async() => {
      for (const mode of ['together', 'progressive', 'immediate']) {
        await page.evaluate(mode => { window.lxData.appSetting['list.loadingMode'] = mode }, mode)
        await route(page, '/search')
        await settled(page)
        await route(page, '/setting?name=SettingBasic')
        await page.waitForFunction(() => document.querySelector('#view > [data-motion-outlet]').getAnimations().some(animation => animation.playState === 'running'))
        await settled(page)
        const title = await page.evaluate(() => window.i18n.t('setting__list'))
        await page.getByRole('tab', { name: title, exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('#view [data-motion-outlet] [data-motion-outlet]')].some(element => element.getAnimations().some(animation => animation.playState === 'running')))
        await settled(page)
        assert.deepEqual(await geometry(), original)
      }
      await page.evaluate(() => { window.lxData.appSetting['list.loadingMode'] = 'together' })
    })

    await t.test('source dropdown plays its exit and can reopen during exit', async() => {
      await route(page, '/songList/list')
      await settled(page)
      const combo = page.locator('#view [role="combobox"]').first()
      const rect = await combo.boundingBox()
      await combo.click()
      await page.waitForTimeout(300)
      await page.locator('#toolbar input').click()
      assert.equal(await page.locator('.selection-flyout-leave-active').count(), 1)
      await combo.click()
      await page.waitForTimeout(300)
      assert.equal(await page.locator('.selection-list').count(), 1)
      await combo.press('Escape')
      await page.locator('.selection-list').waitFor({ state: 'detached' })
      assert.equal(await page.locator('.selection-list').count(), 0)
      assert.deepEqual(await combo.boundingBox(), rect)
      await route(page, '/leaderboard')
      await settled(page)
      assert.deepEqual(await geometry(), original)
    })

    await seedTrack(page)
    await t.test('all three player bars use their actual cover position', async() => {
      for (const style of ['mini', 'middle', 'full']) {
        await page.evaluate(style => { window.lxData.appSetting['common.playBarProgressStyle'] = style }, style)
        await page.waitForTimeout(100)
        const before = await page.locator('#player [data-player-cover]').boundingBox()
        await page.locator('#player [data-player-cover]').click()
        await page.waitForFunction(() => document.querySelector('[data-cover-flight]'))
        const flight = await page.locator('[data-cover-flight]').evaluate(element => {
          const animation = element.getAnimations()[0]
          const time = animation.currentTime
          animation.pause()
          animation.currentTime = 0
          const { x, y, width, height } = element.getBoundingClientRect()
          animation.currentTime = time
          animation.play()
          return { x, y, width, height, duration: animation.effect.getTiming().duration }
        })
        assert.equal(flight.duration, 700)
        for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(flight[key] - before[key]) < 2, `${style}: ${key} follows the footer`)
        await settled(page)
        await page.locator('[data-player-detail] button').first().click()
        await settled(page)
        assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
        assert.deepEqual(await page.locator('#player [data-player-cover]').boundingBox(), before)
      }
    })

    await t.test('reversing player expansion repeatedly leaves no overlay', async() => {
      for (let i = 0; i < 24; i++) {
        await showDetail(page, i % 2 === 0)
        await page.waitForTimeout(35)
      }
      await settled(page)
      assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
      assert.equal(await page.locator('[data-cover-flight]').count(), 0)
    })

    await t.test('lyric motion responds to dragging and settles when disabled', async() => {
      await showDetail(page, true)
      await settled(page)
      await seedLyrics(page)
      await page.waitForTimeout(800)
      const initial = await page.locator('.lyric').evaluate(el => el.scrollTop)
      await page.evaluate(() => window.__motionLine(6))
      await page.waitForFunction(initial => document.querySelector('.lyric').scrollTop > initial + 1, initial)
      const moving = await page.locator('.lyric').evaluate(el => el.scrollTop)
      assert.ok(moving > initial + 1)
      await page.locator('.lyric').dispatchEvent('mousedown', { clientY: 300 })
      const held = await page.locator('.lyric').evaluate(el => el.scrollTop)
      await page.waitForTimeout(150)
      assert.equal(await page.locator('.lyric').evaluate(el => el.scrollTop), held)
      await page.locator('.lyric').dispatchEvent('mouseup')
      await page.evaluate(() => window.__motionLine(3))
      await page.waitForTimeout(80)
      await page.evaluate(() => { window.lxData.appSetting['ui.smoothAnimation'] = false })
      await page.waitForTimeout(50)
      const position = await page.locator('.lyric').evaluate(el => el.scrollTop)
      await page.waitForTimeout(100)
      assert.equal(await page.locator('.lyric').evaluate(el => el.scrollTop), position)
      await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === 'running').length === 0)
      await showDetail(page, false)
      await page.waitForTimeout(50)
      assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
      await page.evaluate(() => { window.lxData.appSetting['ui.smoothAnimation'] = true })
    })

    await t.test('system reduced motion does not disable page, CSS or cover animations', async() => {
      await emulateMotion(page, 'reduce')
      await page.evaluate(() => {
        Object.assign(window.lxData.appSetting, {
          'ui.smoothAnimation': true,
          'ui.animationSpeed': 1,
          'common.isShowAnimation': true,
        })
      })
      await route(page, '/setting')
      await page.waitForFunction(() => document.querySelector('#view > [data-motion-outlet]').getAnimations().length > 0)
      const state = await page.evaluate(() => ({
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        enabled: document.documentElement.dataset.motionEnabled,
        pageDuration: document.querySelector('#view > [data-motion-outlet]').getAnimations()[0]?.effect.getTiming().duration,
        cssDuration: parseFloat(getComputedStyle(document.querySelector('#player button')).transitionDuration),
      }))
      assert.equal(state.reduced, true)
      assert.equal(state.enabled, 'true')
      assert.equal(state.pageDuration, 240)
      assert.ok(state.cssDuration > 0.01)
      await settled(page)
      await showDetail(page, true)
      await page.waitForFunction(() => document.querySelector('[data-cover-flight]'))
      assert.equal(await page.locator('[data-cover-flight]').evaluate(el => {
        window.__motionCoverFlight = el
        window.__motionCoverAnimation = el.getAnimations()[0]
        return window.__motionCoverAnimation.effect.getTiming().duration
      }), 700)
      for (const preference of ['no-preference', 'reduce']) {
        await emulateMotion(page, preference)
        assert.equal(await page.evaluate(() => document.documentElement.dataset.motionEnabled), 'true')
        assert.equal(await page.evaluate(() => window.__motionCoverFlight.isConnected && window.__motionCoverAnimation.playState === 'running'), true)
      }
      await settled(page)
      await showDetail(page, false)
      await settled(page)
      await emulateMotion(page, 'no-preference')
    })

    await t.test('speed and the app animation switches share one clock', async() => {
      await page.evaluate(() => { window.lxData.appSetting['ui.smoothAnimation'] = true })
      await showDetail(page, false)
      await settled(page)
      for (const speed of [0.5, 1.5]) {
        await page.evaluate(speed => { window.lxData.appSetting['ui.animationSpeed'] = speed }, speed)
        await showDetail(page, true)
        await page.waitForFunction(() => document.querySelector('[data-cover-flight]'))
        assert.equal(await page.locator('[data-cover-flight]').evaluate(el => el.getAnimations()[0].effect.getTiming().duration), 700 / speed)
        await page.evaluate(() => { window.lxData.appSetting['ui.smoothAnimation'] = false })
        await settled(page)
        assert.equal(await page.evaluate(() => document.documentElement.dataset.motionEnabled), 'false')
        await showDetail(page, false)
        await page.waitForTimeout(50)
        assert.equal(await page.locator('[data-player-detail]').isVisible(), false)
        await page.evaluate(() => { window.lxData.appSetting['ui.smoothAnimation'] = true })
      }
      await page.evaluate(() => { window.lxData.appSetting['common.isShowAnimation'] = false })
      await route(page, '/search')
      assert.equal(await page.locator('[data-motion-snapshot]').count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.dataset.motionEnabled), 'false')
    })
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(output, 'verified.png') })
    console.log('Motion verification artifacts:', output)
  } finally {
    await app.close()
  }
})
