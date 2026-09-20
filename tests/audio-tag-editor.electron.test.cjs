const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const NodeID3 = require('node-id3')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label } = require('./helpers/plugin-fixture.cjs')
const { mp3, flac } = require('./helpers/tag-fixtures.cjs')

test('the built-in audio tag editor edits downloaded and selected files offline', { timeout: 120000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { app, page } = fixture
  const mp3Path = path.join(profilePath, '鎖那 - コーヒーカップ.mp3')
  const flacPath = path.join(profilePath, '晚风.flac')
  const missingPath = path.join(profilePath, '已移动.mp3')
  const originalMp3 = mp3({ title: 'コーヒーカップ', artist: '鎖那', album: 'sigh.' })
  await fs.writeFile(mp3Path, originalMp3.bytes)
  await fs.writeFile(flacPath, flac(['TITLE=晚风', 'ARTIST=演唱者', 'COMMENT=可以清空的备注']).bytes)
  const task = (id, filePath, complete = true) => ({
    id, isComplate: complete, status: complete ? 'completed' : 'run', progress: complete ? 100 : 20,
    metadata: { filePath, fileName: path.basename(filePath), quality: '128k', musicInfo: { id, name: id, singer: '鎖那', source: 'local', interval: '01:00', meta: {} } },
  })
  const downloads = [task('mp3', mp3Path), { ...task('flac', flacPath), metadata: { ...task('flac', flacPath).metadata, filePath: path.join(profilePath, 'old-location', '晚风.flac') } }, task('missing', missingPath), task('in-progress', path.join(profilePath, '正在下载.mp3'), false), task('unsupported', path.join(profilePath, 'other.wav'))]
  const setupIpc = () => app.evaluate(({ ipcMain }, { downloads, mp3Path }) => {
    ipcMain.removeHandler('winMain_download_list_get')
    ipcMain.handle('winMain_download_list_get', () => downloads)
    global.__tagDialogResult = { canceled: false, filePaths: [mp3Path] }
    ipcMain.removeHandler('winMain_show_select_dialog')
    ipcMain.handle('winMain_show_select_dialog', (_event, options) => {
      global.__tagDialogOptions = options
      return global.__tagDialogResult
    })
  }, { downloads, mp3Path })
  const openEditor = async() => {
    await route(page, '/download')
    await settled(page)
    await page.locator('.list-item').filter({ hasText: 'mp3 - 鎖那' }).click({ button: 'right' })
    await page.getByRole('tab', { name: '修改音频标签', exact: true }).click()
    await page.locator('[data-audio-tag-editor]').waitFor()
  }
  try {
    page.setDefaultTimeout(15000)
    await mockGitHub(app, true)
    await setupIpc()
    await page.evaluate(directory => { window.lxData.appSetting['download.savePath'] = directory; window.lxData.appSetting['download.enable'] = true }, profilePath)
    await openEditor()
    const editor = page.locator('[data-audio-tag-editor]')
    await editor.waitFor()
    await t.test('completed supported downloads can be searched and selected', async() => {
      assert.equal(await editor.locator('aside li').count(), 3)
      assert.equal(await editor.getByText('正在下载.mp3', { exact: true }).count(), 0)
      await editor.getByRole('searchbox').fill('コーヒー')
      assert.equal(await editor.locator('aside li').count(), 1)
      await editor.locator('aside button').filter({ hasText: path.basename(mp3Path) }).click()
      await page.waitForFunction(() => document.querySelector('[data-audio-tag-editor] form input')?.value === 'コーヒーカップ')
      assert.equal(await editor.getByLabel('艺术家', { exact: true }).inputValue(), '鎖那')
      assert.equal(await editor.getByLabel('专辑', { exact: true }).inputValue(), 'sigh.')
      await editor.getByRole('searchbox').fill('')
    })
    await t.test('saving writes real MP3 tags and then disables the save button', async() => {
      await editor.getByLabel('标题', { exact: true }).fill('咖啡与晚风')
      await editor.getByLabel('专辑艺术家', { exact: true }).fill('鎖那 / LX-M')
      await editor.getByLabel('年份 / 日期', { exact: true }).fill('2026')
      await editor.getByLabel('备注', { exact: true }).fill('在软件内修改\n第二行备注')
      await editor.getByRole('button', { name: '保存标签', exact: true }).click()
      await editor.getByText('标签已保存到音频文件。', { exact: true }).waitFor()
      const tags = NodeID3.read(await fs.readFile(mp3Path))
      assert.equal(tags.title, '咖啡与晚风')
      assert.equal(tags.performerInfo, '鎖那 / LX-M')
      assert.equal(tags.year, '2026')
      assert.equal(tags.comment.text, '在软件内修改\n第二行备注')
      assert.equal(await editor.getByRole('button', { name: '保存标签', exact: true }).isDisabled(), true)
      assert.deepEqual((await fs.readFile(mp3Path)).subarray(-originalMp3.audio.length), originalMp3.audio)
    })
    await t.test('drafts survive closing and reopening; reset and canceled selection preserve the current file', async() => {
      await editor.getByLabel('标题', { exact: true }).fill('未保存的草稿')
      await editor.getByLabel('标题', { exact: true }).press('Escape')
      await editor.waitFor({ state: 'hidden' })
      await openEditor()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '未保存的草稿')
      await app.evaluate(() => { global.__tagDialogResult = { canceled: true, filePaths: [] } })
      await editor.getByRole('button', { name: '选择音频文件', exact: true }).click()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '未保存的草稿')
      await editor.locator('aside button').filter({ hasText: '晚风.flac' }).click()
      await page.getByRole('button', { name: '继续编辑', exact: true }).click()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '未保存的草稿')
      await editor.getByRole('button', { name: '还原修改', exact: true }).click()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '咖啡与晚风')
    })
    await t.test('the current download directory is used when an old file path no longer exists', async() => {
      await editor.locator('aside button').filter({ hasText: '晚风.flac' }).click()
      await page.waitForFunction(() => document.querySelector('[data-audio-tag-editor] form input')?.value === '晚风')
      await editor.getByLabel('标题', { exact: true }).fill('新的 FLAC 标题')
      await editor.getByLabel('备注', { exact: true }).fill('')
      await editor.getByLabel('标题', { exact: true }).press('Control+s')
      await editor.getByText('标签已保存到音频文件。', { exact: true }).waitFor()
      const { parseFile } = await import('music-metadata')
      const metadata = await parseFile(flacPath)
      assert.equal(metadata.common.title, '新的 FLAC 标题')
      assert.equal(metadata.common.comment, undefined)
    })
    await t.test('missing downloads report an error while keeping the current editor intact', async() => {
      await editor.locator('aside button').filter({ hasText: path.basename(missingPath) }).click()
      await editor.getByRole('alert').waitFor()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '新的 FLAC 标题')
    })
    await t.test('a local file can be selected and the form fits small and large windows', async() => {
      await app.evaluate((_electron, mp3Path) => { global.__tagDialogResult = { canceled: false, filePaths: [mp3Path] } }, mp3Path)
      await editor.getByRole('button', { name: '选择音频文件', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('[data-audio-tag-editor] form input')?.value === '咖啡与晚风').catch(async error => {
        console.error('File picker diagnostics:', await editor.innerText(), await app.evaluate(() => ({ result: global.__tagDialogResult, options: global.__tagDialogOptions })))
        await page.screenshot({ path: path.join(profilePath, 'file-picker-failure.png') })
        throw error
      })
      const options = await app.evaluate(() => global.__tagDialogOptions)
      assert.deepEqual(options.filters[0].extensions, ['mp3', 'flac'])
      const window = await app.browserWindow(page)
      for (const width of [828, 1280]) {
        await window.evaluate((window, width) => window.setSize(width, 850), width)
        await page.waitForTimeout(250)
        await page.screenshot({ path: path.join(profilePath, `tag-editor-${width}.png`) })
        const bounds = await editor.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, viewport: window.innerWidth }))
        assert.ok(bounds.scroll <= bounds.client + 1, JSON.stringify(bounds))
        assert.equal(await editor.locator('form input').evaluateAll(inputs => inputs.every(input => input.getBoundingClientRect().right <= window.innerWidth)), true)
      }
      await window.dispose()
    })
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    await mockGitHub(app, true)
    await setupIpc()
    await openStore(page)
    await t.test('offline restart keeps the built-in editor available without installation', async() => {
      assert.equal(await page.getByRole('tab', { name: '音频标签编辑', exact: true }).count(), 0)
      assert.equal(await page.locator('[data-plugin-id="audio-tag-editor"] [data-plugin-status]').innerText(), '自带')
      assert.equal(await page.locator('[data-plugin-id="audio-tag-editor"]').getByRole('button', { name: await label(page, 'setting__plugins_uninstall'), exact: true }).count(), 0)
      assert.equal(await page.locator('[data-plugin-id="audio-tag-editor"]').getByRole('button').count(), 0)
      await openEditor()
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Audio tag editor screenshots:', profilePath)
  } catch (error) {
    await page.screenshot({ path: path.join(profilePath, 'tag-editor-failure.png') }).catch(() => {})
    console.error('Audio tag editor diagnostics:', profilePath)
    throw error
  } finally { await fixture?.app.close().catch(() => {}) }
})
