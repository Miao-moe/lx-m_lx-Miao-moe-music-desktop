const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, label } = require('./helpers/plugin-fixture.cjs')

const openFonts = async page => {
  await route(page, '/setting?name=SettingBasic')
  await settled(page)
  await page.locator('[data-font-primary]').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-font-primary] .label')].some(node => node.textContent))
}
const choose = async(page, target, label) => {
  const field = page.locator(`[data-font-${target}]`)
  await field.getByRole('combobox').click()
  await field.locator('li').filter({ hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).click()
}
const importFile = async(app, page, filename) => {
  await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] }) }, filename)
  await page.locator('[data-font-import]').click()
  await page.waitForFunction(() => !document.querySelector('[data-font-import]').disabled)
}
const usedFonts = async page => {
  const session = await page.context().newCDPSession(page)
  try {
    await session.send('DOM.enable')
    await session.send('CSS.enable')
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-font-preview]' })
    return (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts
  } finally { await session.detach() }
}

test('custom fonts render, fall back, validate imports and persist independently of the source file', { timeout: 120000, skip: process.platform !== 'win32' }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const original = path.join(profilePath, 'Imported Arial.ttf')
  const invalid = path.join(profilePath, 'Broken.ttf')
  try {
    await fs.copyFile(path.join(process.env.WINDIR || 'C:/Windows', 'Fonts/arial.ttf'), original)
    await fs.writeFile(invalid, Buffer.from([0, 1, 0, 0, 1, 2, 3, 4]))
    await openFonts(page)
    await t.test('both labeled font controls are available, including fallback with default primary', async() => {
      assert.equal(await page.locator('[data-font-fallback] [role="combobox"]').isVisible(), true)
      await choose(page, 'fallback', 'Microsoft YaHei UI')
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === 'system-ui, "Microsoft YaHei UI"')
      await choose(page, 'primary', 'Arial')
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === '"Arial", "Microsoft YaHei UI"')
      const fonts = await usedFonts(page)
      assert(fonts.some(font => /Arial/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
      assert(fonts.some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
    })
    let importedId
    await t.test('a real imported font renders immediately and repeated imports share one saved copy', async() => {
      await importFile(app, page, original)
      await page.waitForFunction(() => document.documentElement.style.fontFamily.includes('LXCustom-') && [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      importedId = await page.evaluate(() => window.lxData.appSetting['common.font'])
      assert(importedId.endsWith(', "Microsoft YaHei UI"'))
      const fonts = await usedFonts(page)
      assert(fonts.some(font => font.isCustomFont && font.glyphCount > 0), JSON.stringify(fonts))
      assert(fonts.some(font => /YaHei/i.test(font.familyName) && font.glyphCount > 0), JSON.stringify(fonts))
      await importFile(app, page, original)
      const directory = path.join(profilePath, 'portable/userData/LxDatas/fonts')
      assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.json')).length, 1)
      await page.screenshot({ path: path.join(profilePath, 'custom-font-selection.png') })
    })
    await t.test('Folia receives separate primary and fallback families and can load the imported face', async() => {
      await mockGitHub(app)
      await openStore(page)
      await install(page, 'folia-lyrics')
      await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      const element = await page.locator('[data-folia-stage="preview"] iframe').elementHandle()
      const frame = await element.contentFrame()
      await page.locator('[data-folia-mode]').selectOption('still')
      await frame.waitForFunction(() => document.documentElement.dataset.mode === 'still' && [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      const family = await frame.locator('#root [style*="font-family"]').first().evaluate(node => window.getComputedStyle(node).fontFamily)
      assert.match(family, /^LXCustom-[a-f0-9]{64}, "Microsoft YaHei UI",/)
      assert.equal(family.includes('\\"'), false, 'font choices must not become one quoted composite name')
      await page.locator('[data-folia-stage="preview"]').screenshot({ path: path.join(profilePath, 'custom-font-folia.png') })
      await openFonts(page)
    })
    await t.test('a corrupt font reports its error and preserves the active font', async() => {
      await importFile(app, page, invalid)
      const message = await page.locator('[data-font-error]').innerText()
      assert.match(message, /FONT_IMPORT_FAILED|SYNTAX|12/)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.font']), importedId)
    })
    await fs.unlink(original)
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    await openFonts(page)
    await t.test('fonts and fallback survive restart without the original file', async() => {
      assert.equal(await page.evaluate(() => window.lxData.appSetting['common.font']), importedId)
      await page.waitForFunction(() => [...document.fonts].some(face => face.family.includes('LXCustom-') && face.status === 'loaded'))
      await page.waitForFunction(() => document.querySelector('[data-font-primary] .label').textContent.includes('Imported Arial'))
      assert((await usedFonts(page)).some(font => font.isCustomFont && font.glyphCount > 0))
    })
    await t.test('restore defaults clears both choices and unloads custom faces', async() => {
      await page.locator('[data-font-reset]').click()
      await page.waitForFunction(() => window.lxData.appSetting['common.font'] === '' && document.documentElement.style.fontFamily === '')
      assert.equal(await page.locator('#lx-custom-fonts').textContent(), '')
      assert.equal((await usedFonts(page)).some(font => font.isCustomFont), false)
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Custom font UI evidence:', profilePath)
  } catch (error) {
    console.error('Custom font profile:', profilePath, fixture.errors)
    await page.screenshot({ path: path.join(profilePath, 'custom-font-failure.png') }).catch(() => {})
    throw error
  } finally { await app.close().catch(() => {}) }
})
