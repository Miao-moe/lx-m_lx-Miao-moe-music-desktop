const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

test('an oversized timed-pause value starts on the first confirmation', { timeout: 60000 }, async() => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  try {
    await route(page, '/setting?name=SettingBasic')
    await settled(page)
    const label = key => page.evaluate(key => window.i18n.t(key), key)
    const open = async() => {
      await page.getByRole('button', { name: await label('setting__play_timeout') }).click()
      return page.getByRole('heading', { name: await label('play_timeout') }).locator('..')
    }
    let modal = await open()
    await modal.locator('input[type="number"]').fill('1441')
    await modal.getByRole('button', { name: await label('play_timeout_confirm') }).click()
    await page.waitForFunction(() => window.lxData.appSetting['player.waitPlayEndStopTime'] === '1440')
    await page.getByRole('heading', { name: await label('play_timeout') }).waitFor({ state: 'hidden' })

    modal = await open()
    await modal.locator('input[type="number"]').fill('0')
    await modal.getByRole('button', { name: await label('play_timeout_update') }).click()
    assert.equal(await modal.getByRole('alert').innerText(), await label('play_timeout_invalid'))
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.waitPlayEndStopTime']), '1440')
    assert.deepEqual(fixture.errors, [])
  } finally {
    await app.close()
  }
})
