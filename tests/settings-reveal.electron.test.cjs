const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, label } = require('./helpers/plugin-fixture.cjs')

const reveal = id => `[data-setting-reveal][data-setting-search-depends~="${id}"]`
const idle = page => page.waitForFunction(() => [...document.querySelectorAll('[data-setting-reveal]')].every(element =>
  !element.getAnimations().length && (element.getAttribute('aria-hidden') !== 'true' || getComputedStyle(element).display === 'none')))
const set = (page, values) => page.evaluate(async values => {
  await require('electron').ipcRenderer.invoke('common_set_app_setting', values)
  Object.assign(window.lxData.appSetting, values)
}, values)
const click = async(page, id) => {
  await page.locator(`label[for="${id}"]`).click()
  await page.waitForFunction(id => {
    const input = document.getElementById(id)
    return input.labels[0].querySelector('[aria-checked]').getAttribute('aria-checked') === String(input.checked)
  }, id)
}

const sampleToggle = (page, id) => page.evaluate(async({ selector, id }) => {
  const panel = document.querySelector(selector)
  const frames = []
  document.querySelector(`label[for="${id}"]`).click()
  const start = performance.now()
  await new Promise(resolve => {
    const sample = now => {
      frames.push({ time: now - start, height: panel.getBoundingClientRect().height, opacity: Number(getComputedStyle(panel).opacity) })
      if (now - start > 650) resolve()
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  return frames
}, { selector: reveal(id), id })

const assertSmooth = (frames, opening) => {
  const fullHeight = Math.max(...frames.map(frame => frame.height))
  assert(fullHeight > 10)
  assert(frames.some(frame => frame.height > 1 && frame.height < fullHeight - 1), 'height must pass through an intermediate value')
  assert(frames.some(frame => frame.opacity > 0.01 && frame.opacity < 0.99), 'opacity must fade')
  assert.equal(frames.at(-1).opacity, opening ? 1 : 0)
  if (!opening) assert.equal(frames.at(-1).height, 0)
}

test('dependent settings expand smoothly, retain values and remain usable with search and reduced motion', { timeout: 180000 }, async t => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html'), args: ['--disable-backgrounding-occluded-windows'] })
  const { app, page, output } = fixture
  page.setDefaultTimeout(8000)
  const open = async(name, values = {}) => {
    await set(page, values)
    await route(page, '/setting?name=' + name)
    await settled(page)
    await idle(page)
  }
  const gapless = 'setting_advanced_play_gapless'
  const fade = 'setting_advanced_play_fade'
  try {
    await open('SettingAdvanced', { 'player.gaplessPlayback': false, 'player.fadeInFadeOut': false, 'player.fadeDuration': 1400, 'ui.animationSpeed': 0.5 })

    await t.test('gapless, crossfade and duration open in two animated levels and keep their saved values', async() => {
      assert.equal(await page.locator(`label[for="${fade}"]`).isVisible(), false)
      assertSmooth(await sampleToggle(page, gapless), true)
      assert.equal(await page.locator('#' + fade).isDisabled(), false)
      assert.equal(await page.locator(reveal(fade)).isVisible(), false)
      assertSmooth(await sampleToggle(page, fade), true)
      assertSmooth(await sampleToggle(page, gapless), false)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.fadeDuration']), 1400)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.fadeInFadeOut']), true)
      await click(page, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(fade)).isVisible(), true)
      await page.screenshot({ path: path.join(output, 'settings-reveal-advanced.png') })
    })

    await t.test('rapid reversals finish without stale height, hidden focus targets or lost state', async() => {
      await page.evaluate(async id => {
        for (let i = 0; i < 7; ++i) {
          document.querySelector(`label[for="${id}"]`).click()
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        }
      }, gapless)
      await idle(page)
      const panel = page.locator(reveal(gapless))
      assert.equal(await panel.isVisible(), false)
      assert.equal(await panel.getAttribute('inert'), '')
      assert.equal(await panel.evaluate(element => element.getBoundingClientRect().height), 0)
      await click(page, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(fade)).isVisible(), true)
      assert.equal(await panel.locator('[data-setting-reveal-content]').first().evaluate(element => getComputedStyle(element).overflow), 'visible')
    })

    await t.test('collapsing a focused group returns focus to its controlling checkbox', async() => {
      await page.locator(`label[for="${fade}"] [role="checkbox"]`).focus()
      await page.evaluate(id => document.querySelector(`label[for="${id}"]`).click(), gapless)
      await page.waitForFunction(id => document.querySelector(`label[for="${id}"] [role="checkbox"]`) === document.activeElement, gapless)
      assert.equal(await page.locator(reveal(gapless)).getAttribute('inert'), '')
      await page.locator(`label[for="${fade}"] [role="checkbox"]`).evaluate(element => element.focus())
      assert.equal(await page.evaluate(id => document.querySelector(`label[for="${id}"] [role="checkbox"]`) === document.activeElement, gapless), true)
      await idle(page)
    })

    await t.test('disabling animation mid-transition settles immediately and speed follows the shared setting', async() => {
      assert.equal(await page.locator(reveal(gapless)).evaluate(element => getComputedStyle(element).transitionDuration), '0.5s, 0.5s')
      await page.evaluate(async id => {
        document.querySelector(`label[for="${id}"]`).click()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        window.lxData.appSetting['ui.smoothAnimation'] = false
      }, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(gapless)).isVisible(), true)
      await click(page, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(gapless)).isVisible(), false)
      await set(page, { 'ui.smoothAnimation': true, 'ui.animationSpeed': 1.5 })
      await page.waitForFunction(() => document.documentElement.dataset.motionSpeed === '1.5')
      const duration = await page.locator(reveal(gapless)).evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))
      assert(Math.abs(duration - 1 / 6) < 0.001)
    })

    await t.test('system reduced motion opens and closes without a transition', async() => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await click(page, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(gapless)).evaluate(element => getComputedStyle(element).transitionDuration), '0s')
      assert.equal(await page.locator(reveal(fade)).isVisible(), true)
      await click(page, gapless)
      await idle(page)
      assert.equal(await page.locator(reveal(gapless)).isVisible(), false)
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await set(page, { 'ui.animationSpeed': 1 })
    })

    await t.test('lyrics, background, proxy, OpenAPI, desktop lyrics and automatic sync reveal their dependent options', async() => {
      const cases = [
        ['SettingDownload', 'download.isEmbedLyric', 'setting_download_isEmbedLyric'],
        ['SettingDownload', 'download.isDownloadLrc', 'setting_download_isDownloadLrc'],
        ['SettingAdvanced', 'ui.ambientBackground', 'setting_advanced_background_enabled'],
        ['SettingNetwork', 'network.proxy.enable', 'setting_network_proxy_enable'],
        ['SettingOpenAPI', 'openAPI.enable', 'setting_open_api_enable'],
        ['SettingDesktopLyric', 'desktopLyric.isAlwaysOnTop', 'setting_desktop_lyric_alwaysOnTop'],
        ['SettingDesktopLyric', 'desktopLyric.isLock', 'setting_desktop_lyric_lock'],
        ['SettingSync', 'sync.webdav.autoSync', 'setting_sync_webdav_auto'],
      ]
      for (const [name, key, id] of cases) {
        await open(name, { [key]: false })
        const panels = page.locator(reveal(id))
        assert(await panels.count() > 0, id)
        for (const panel of await panels.all()) assert.equal(await panel.isVisible(), false, id)
        // Drive external-service settings through their reactive state to avoid starting servers or changing the test proxy.
        const external = name === 'SettingNetwork' || name === 'SettingOpenAPI'
        if (external) await page.evaluate(key => { window.lxData.appSetting[key] = true }, key)
        else await click(page, id)
        await idle(page)
        for (const panel of await panels.all()) {
          assert.equal(await panel.isVisible(), true, id)
          assert.equal(await panel.getAttribute('inert'), null, id)
          assert.equal(await panel.locator('input:disabled, select:disabled').count(), 0, id)
        }
        if (external) await page.evaluate(key => { window.lxData.appSetting[key] = false }, key)
        else await set(page, { [key]: false })
        await idle(page)
      }
    })

    await t.test('local and global hotkey editors and random animations collapse with their switches', async() => {
      await open('SettingHotKey')
      for (const id of ['setting_download_hotKeyLocal', 'setting_download_hotKeyGlobal']) {
        if (await page.locator('#' + id).isChecked()) await click(page, id)
        await idle(page)
        assert.equal(await page.locator(reveal(id)).isVisible(), false)
        await click(page, id)
        await idle(page)
        assert.equal(await page.locator(reveal(id)).isVisible(), true)
        assert(await page.locator(reveal(id)).locator('input').count() > 0)
        await click(page, id)
        await idle(page)
      }
      await open('SettingBasic', { 'common.isShowAnimation': false })
      assert.equal(await page.locator('label[for="setting_animate"]').isVisible(), false)
      await click(page, 'setting_show_animate')
      await idle(page)
      assert.equal(await page.locator('label[for="setting_animate"]').isVisible(), true)
      assert.equal(await page.locator('#setting_animate').isDisabled(), false)
    })

    await t.test('sync mode sections animate when switching and preserve editable connection fields', async() => {
      await open('SettingSync', { 'sync.enable': false })
      const client = page.locator('dd[data-setting-search="setting__sync_client"]')
      const server = page.locator('dd[data-setting-search="setting__sync_server"]')
      await click(page, 'setting_sync_mode_client')
      await idle(page)
      assert.equal(await client.isVisible(), true)
      assert.equal(await client.locator('input').isEnabled(), true)
      assert.equal(await server.isVisible(), false)
      await click(page, 'setting_sync_mode_server')
      await idle(page)
      assert.equal(await client.isVisible(), false)
      assert.equal(await server.isVisible(), true)
    })

    await t.test('search finds a collapsed subgroup and retains every switch needed to open it', async() => {
      await open('SettingAdvanced', { 'player.gaplessPlayback': false, 'player.fadeInFadeOut': false })
      const search = page.getByRole('textbox', { name: await label(page, 'setting__filter_placeholder'), exact: true })
      await search.fill(await label(page, 'setting__advanced_play_fade_duration'))
      await page.locator(`label[for="${gapless}"]`).waitFor()
      await click(page, gapless)
      await idle(page)
      await click(page, fade)
      await idle(page)
      assert.equal(await page.locator(reveal(fade)).isVisible(), true)
      await search.press('Escape')
      await open('SettingDownload', { 'download.isDownloadLrc': false })
      await search.fill(await label(page, 'setting__download_lyric_format'))
      await page.locator('label[for="setting_download_isDownloadLrc"]').waitFor()
      await click(page, 'setting_download_isDownloadLrc')
      await idle(page)
      assert.equal(await page.locator('#download_lyric_format').isVisible(), true)
      assert.equal(await page.locator('label[for="setting_download_lrcFormat_gbk"]').isVisible(), true)
      await search.press('Escape')
    })

    await t.test('built-in sound effects use animated editable parameters offline', async() => {
      await mockGitHub(app, true)
      await seedTrack(page)
      await showDetail(page, true)
      await settled(page)
      await page.locator('[data-sound-effect-button]').click()
      await page.locator('[data-plugin-sound-dialog]').waitFor()
      await set(page, { 'player.soundEffect.panner.enable': false, 'player.soundEffect.convolution.fileName': '' })
      await idle(page)
      const panner = 'player__sound_effect_panner_enabled'
      assert.equal(await page.locator(reveal(panner)).isVisible(), false)
      await click(page, panner)
      await idle(page)
      assert.equal(await page.locator(reveal(panner)).isVisible(), true)
      const convolution = await page.locator('[id^="player__convolution_"]').first().getAttribute('id')
      for (const panel of await page.locator(reveal(convolution)).all()) assert.equal(await panel.isVisible(), false)
      await click(page, convolution)
      await idle(page)
      for (const panel of await page.locator(reveal(convolution)).all()) {
        assert.equal(await panel.isVisible(), true)
        assert.equal(await panel.locator('[disabled]').count(), 0)
      }
      await page.screenshot({ path: path.join(output, 'settings-reveal-sound-effects.png') })
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Settings reveal screenshots:', output)
  } finally {
    await app.close()
  }
})
