const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

test('app animation switches survive restarts and obsolete system preferences are discarded', { timeout: 60000 }, async t => {
  let fixture
  let profilePath
  const start = async() => {
    fixture = await launch({ profilePath, initializeMotion: false, reducedMotion: 'reduce', args: ['--disable-backgrounding-occluded-windows'] })
    profilePath ??= fixture.output
  }
  const close = async() => {
    assert.deepEqual(fixture.errors, [])
    await fixture.app.close()
    fixture = null
  }
  const state = () => fixture.page.evaluate(() => ({
    hasObsoleteSetting: Object.hasOwn(window.lxData.appSetting, 'ui.followSystemMotion'),
    smooth: window.lxData.appSetting['ui.smoothAnimation'],
    enabled: document.documentElement.dataset.motionEnabled,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  }))
  const configPath = () => path.join(profilePath, 'portable/userData/LxDatas/config_v2.json')
  const config = async() => JSON.parse(await fs.readFile(configPath(), 'utf8')).setting
  const openAdvanced = async() => {
    await route(fixture.page, '/setting')
    await settled(fixture.page)
    const title = await fixture.page.evaluate(() => window.i18n.t('setting__advanced'))
    await fixture.page.getByRole('tab', { name: title, exact: true }).click()
    await settled(fixture.page)
  }
  try {
    await start()
    await t.test('fresh settings use the app animation switches', async() => {
      assert.deepEqual(await state(), { hasObsoleteSetting: false, smooth: true, enabled: 'true', reduced: true })
      assert.equal(Object.hasOwn(await config(), 'ui.followSystemMotion'), false)
      await openAdvanced()
      assert.equal(await fixture.page.locator('#setting_advanced_ui_follow_system_motion').count(), 0)
      assert.equal(await fixture.page.locator('#setting_advanced_ui_smooth_anim').count(), 1)
    })
    await t.test('the smooth animation checkbox still disables and saves motion', async() => {
      await fixture.page.locator('label[for="setting_advanced_ui_smooth_anim"]').click()
      await fixture.page.waitForFunction(() => document.documentElement.dataset.motionEnabled === 'false')
      assert.equal((await config())['ui.smoothAnimation'], false)
    })
    await close()
    await start()
    await t.test('the app switch is restored and can enable motion despite system reduction', async() => {
      assert.deepEqual(await state(), { hasObsoleteSetting: false, smooth: false, enabled: 'false', reduced: true })
      await openAdvanced()
      await fixture.page.locator('label[for="setting_advanced_ui_smooth_anim"]').click()
      await fixture.page.waitForFunction(() => document.documentElement.dataset.motionEnabled === 'true')
      await fixture.page.evaluate(() => window.lxData.updateSetting({ 'ui.animationSpeed': 1.2 }))
      await fixture.page.waitForFunction(() => document.documentElement.dataset.motionSpeed === '1.2')
      const saved = await config()
      assert.equal(saved['ui.smoothAnimation'], true)
      assert.equal(saved['ui.animationSpeed'], 1.2)
    })
    await close()
    // Simulate upgrading a profile that explicitly opted into the removed setting.
    const previous = JSON.parse(await fs.readFile(configPath(), 'utf8'))
    previous.setting['ui.followSystemMotion'] = true
    await fs.writeFile(configPath(), JSON.stringify(previous))
    for (let i = 0; i < 2; i++) {
      await start()
      await t.test(`app-controlled motion still plays after restart ${i + 1}`, async() => {
        assert.deepEqual(await state(), { hasObsoleteSetting: false, smooth: true, enabled: 'true', reduced: true })
        await route(fixture.page, '/search')
        await settled(fixture.page)
        await route(fixture.page, '/setting')
        await fixture.page.waitForFunction(() => document.querySelector('#view > [data-motion-outlet]').getAnimations().length > 0)
        assert.equal(await fixture.page.locator('#view > [data-motion-outlet]').evaluate(el => el.getAnimations()[0].effect.getTiming().duration), 200)
        assert.equal(Object.hasOwn(await config(), 'ui.followSystemMotion'), false)
      })
      await close()
    }
  } finally {
    if (fixture) await fixture.app.close()
  }
})
