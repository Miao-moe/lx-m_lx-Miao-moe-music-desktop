const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const action = 'common_toggle_fullscreen'
const configPath = output => path.join(output, 'portable/userData/LxDatas/hot_key.json')
const savedConfig = async output => JSON.parse(await fs.readFile(configPath(output), 'utf8'))
const waitSavedKey = async(output, type, key) => {
  for (let i = 0; i < 60; i++) {
    const config = await savedConfig(output)
    const found = Object.entries(config[type].keys).find(([, info]) => info.action === action)?.[0]
    if (found === key) return
    await delay(25)
  }
  assert.fail(`The ${type} fullscreen shortcut was not saved as ${key}`)
}
const openHotkeys = async page => {
  await route(page, '/setting')
  await settled(page)
  const labels = await page.evaluate(() => ({
    title: window.i18n.t('setting__hot_key'),
    fullscreen: window.i18n.t('setting__hot_key_common_toggle_fullscreen'),
  }))
  await page.getByRole('tab', { name: labels.title, exact: true }).click()
  await settled(page)
  // Disabled shortcut groups are collapsed until their enable switch is checked.
  if (!await page.locator('#setting_download_hotKeyGlobal').isChecked()) {
    await page.locator('label[for="setting_download_hotKeyGlobal"]').click()
    await page.waitForFunction(() => window.lx.appHotKeyConfig.global.enable)
    await settled(page)
  }
  return page.getByRole('heading', { name: labels.fullscreen, exact: true }).locator('..').locator('input')
}
const editKey = async(page, input, shortcut) => {
  await input.click()
  await page.waitForFunction(() => window.lx.isEditingHotKey)
  await page.keyboard.press(shortcut)
  assert.equal(await page.locator('html.fullscreen').count(), 0, 'Recording a shortcut must not invoke it')
  await page.locator('#hot_key').click()
  await page.waitForFunction(() => !window.lx.isEditingHotKey)
}
const assertNoFullscreen = async(page, shortcut) => {
  await page.keyboard.press(shortcut)
  await page.waitForTimeout(150)
  assert.equal(await page.locator('html.fullscreen').count(), 0)
}
const toggleTwice = async(page, shortcut) => {
  await page.keyboard.press(shortcut)
  await page.locator('html.fullscreen').waitFor()
  await page.keyboard.press(shortcut)
  await page.locator('html:not(.fullscreen)').waitFor()
}

test('fullscreen shortcuts can be edited, disabled, cleared and retained after restart', { timeout: 90000 }, async() => {
  const rendererPath = path.resolve(__dirname, '../dist/index.html')
  let fixture = await launch({ rendererPath })
  const output = fixture.output
  const restart = async() => { fixture = await launch({ profilePath: output, rendererPath }) }
  const close = async() => {
    const current = fixture
    fixture = null
    await current.app.close()
    assert.deepEqual(current.errors, [])
  }
  try {
    let { page } = fixture
    page.setDefaultTimeout(6000)
    let inputs = await openHotkeys(page)
    assert.equal(await inputs.count(), 2, 'Local and global shortcut settings must both include fullscreen')
    assert.equal(await inputs.nth(0).inputValue(), 'F11')
    assert.equal(await inputs.nth(1).inputValue(), '')

    await page.locator('#hot_key').click()
    await page.keyboard.down('F11')
    await page.locator('html.fullscreen').waitFor()
    await page.keyboard.down('F11')
    await page.waitForTimeout(150)
    assert.equal(await page.locator('html.fullscreen').count(), 1, 'Holding the shortcut must not toggle repeatedly')
    await page.keyboard.up('F11')
    await page.keyboard.press('Escape')
    await page.locator('html:not(.fullscreen)').waitFor()

    await editKey(page, inputs.nth(0), 'Control+Shift+F10')
    await waitSavedKey(output, 'local', 'mod+shift+f10')
    assert.equal(await inputs.nth(0).inputValue(), 'Ctrl + Shift + F10')
    await assertNoFullscreen(page, 'F11')
    await toggleTwice(page, 'Control+Shift+F10')

    await page.locator('label[for="setting_download_hotKeyLocal"]').click()
    await page.waitForFunction(() => !window.lx.appHotKeyConfig.local.enable)
    await assertNoFullscreen(page, 'Control+Shift+F10')
    await page.locator('label[for="setting_download_hotKeyLocal"]').click()
    await page.waitForFunction(() => window.lx.appHotKeyConfig.local.enable)

    await editKey(page, inputs.nth(1), 'Control+Alt+F10')
    await waitSavedKey(output, 'global', 'mod+alt+f10')
    // Exercise the main-process global shortcut dispatch without reserving OS shortcuts.
    await fixture.app.evaluate(() => global.lx.event_app.hot_key_down({ type: 'global', key: 'mod+alt+f10' }))
    await page.locator('html.fullscreen').waitFor()
    await fixture.app.evaluate(() => global.lx.event_app.hot_key_down({ type: 'global', key: 'mod+alt+f10' }))
    await page.locator('html:not(.fullscreen)').waitFor()
    await close()

    await restart()
    page = fixture.page
    inputs = await openHotkeys(page)
    assert.equal(await inputs.nth(0).inputValue(), 'Ctrl + Shift + F10')
    assert.equal(await inputs.nth(1).inputValue(), 'Ctrl + Alt + F10')
    await page.locator('#hot_key').click()
    await toggleTwice(page, 'Control+Shift+F10')
    await editKey(page, inputs.nth(0), 'Backspace')
    await waitSavedKey(output, 'local', undefined)
    await assertNoFullscreen(page, 'Control+Shift+F10')
    await assertNoFullscreen(page, 'F11')
    await close()

    await restart()
    page = fixture.page
    inputs = await openHotkeys(page)
    assert.equal(await inputs.nth(0).inputValue(), '')
    await page.locator('#hot_key').click()
    await assertNoFullscreen(page, 'F11')
    assert.equal((await savedConfig(output)).version, 2)
  } finally {
    if (fixture) await close()
  }
})

test('old shortcut configurations gain F11 without overwriting existing bindings', { timeout: 60000 }, async t => {
  const initial = await launch()
  const output = initial.output
  await initial.app.close()
  const defaults = await savedConfig(output)
  const existing = defaults.local.keys['mod+f5']
  for (const conflict of [null, 'local', 'global']) {
    await t.test(conflict ? `preserve an existing ${conflict} F11 assignment` : 'add F11 to an older unassigned configuration', async() => {
      const oldConfig = {
        version: 1,
        local: { enable: true, keys: {} },
        global: { enable: false, keys: {} },
      }
      if (conflict) oldConfig[conflict].keys.f11 = existing
      await fs.writeFile(configPath(output), JSON.stringify(oldConfig))
      const { app, page, errors } = await launch({ profilePath: output })
      try {
        const config = await savedConfig(output)
        assert.equal(config.version, 2)
        if (conflict) {
          assert.deepEqual(config[conflict].keys.f11, existing)
          assert.equal(Object.values(config.local.keys).some(info => info.action === action), false)
        } else {
          assert.equal(config.local.keys.f11.action, action)
          await toggleTwice(page, 'F11')
        }
        assert.deepEqual(errors, [])
      } finally {
        await app.close()
      }
    })
  }
})
