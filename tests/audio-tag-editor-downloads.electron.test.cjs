const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const NodeID3 = require('node-id3')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, install, uninstall, label } = require('./helpers/plugin-fixture.cjs')
const { mp3, flac } = require('./helpers/tag-fixtures.cjs')

test('Downloads opens the tag editor for the clicked file and handles stale files and task state', { timeout: 120000 }, async t => {
  const { app, page, errors, output } = await launch({ rendererPath: path.resolve('dist/index.html') })
  const alphaPath = path.join(output, 'alpha-song.mp3')
  const betaPath = path.join(output, 'beta-song.flac')
  const missingPath = path.join(output, 'missing-song.mp3')
  const directoryPath = path.join(output, 'directory-song.mp3')
  const alphaBytes = mp3({ title: 'Alpha' }).bytes
  const betaBytes = flac(['TITLE=Beta']).bytes
  await fs.writeFile(alphaPath, alphaBytes)
  await fs.writeFile(betaPath, betaBytes)
  await fs.mkdir(directoryPath)
  const task = (id, filePath, status = 'completed', isComplate = true) => ({
    id, isComplate, status, progress: isComplate ? 100 : 25, statusText: status,
    metadata: {
      filePath, fileName: path.basename(filePath), quality: '128k', listId: 'default',
      musicInfo: { id, name: id, singer: 'Artist', source: 'local', interval: '01:00', meta: { albumName: '', picUrl: '' } },
    },
  })
  const tasks = [task('alpha-song', alphaPath), task('beta-song', betaPath), task('missing-song', missingPath), task('directory-song', directoryPath),
    task('unsupported-song', path.join(output, 'unsupported.wav')), task('unfinished-song', alphaPath, 'pause', false), task('restarted-song', betaPath, 'run')]
  const editor = page.locator('[data-plugin-settings="audio-tag-editor"]')
  const menu = () => page.getByRole('tab', { name: '修改音频标签', exact: true })
  const downloads = async() => { await route(page, '/download'); await settled(page); await page.locator('.list-item').first().waitFor() }
  const rightClick = async id => {
    await downloads()
    await page.locator('.list-item').filter({ hasText: id }).click({ button: 'right' })
  }
  const dismiss = async text => {
    await page.getByText(text, { exact: true }).waitFor()
    await page.getByRole('button', { name: await label(page, 'confirm_button_text'), exact: true }).click()
    await page.waitForFunction(() => !document.querySelector('[data-plugin-settings="audio-tag-editor"]') || !document.querySelector('[data-plugin-settings="audio-tag-editor"] fieldset')?.disabled)
  }
  const title = async value => {
    await editor.waitFor()
    await page.waitForFunction(value => document.querySelector('[data-plugin-settings="audio-tag-editor"] form input')?.value === value, value)
  }
  try {
    page.setDefaultTimeout(15000)
    await mockGitHub(app)
    await app.evaluate(({ ipcMain }, tasks) => {
      ipcMain.removeHandler('winMain_download_list_get')
      ipcMain.handle('winMain_download_list_get', () => tasks)
    }, tasks)
    await page.evaluate(directory => { window.lxData.appSetting['download.savePath'] = directory; window.lxData.appSetting['download.enable'] = true }, output)
    await t.test('the menu only exists while the plugin is installed', async() => {
      await rightClick('alpha-song')
      assert.equal(await menu().count(), 0)
      await page.keyboard.press('Escape')
      await openStore(page)
      await install(page, 'audio-tag-editor')
      await rightClick('alpha-song')
      await menu().waitFor()
      assert.equal(await menu().getAttribute('disabled'), null)
      await page.screenshot({ path: path.join(output, 'download-tag-menu.png') })
      await menu().click()
      await title('Alpha')
      await editor.getByLabel('标题', { exact: true }).fill('通过下载右键修改')
      await editor.getByRole('button', { name: '保存标签', exact: true }).click()
      await editor.getByRole('status').filter({ hasText: '标签已保存到音频文件。' }).waitFor()
      assert.equal(NodeID3.read(await fs.readFile(alphaPath)).title, '通过下载右键修改')
    })
    await t.test('reopening the same file keeps the draft and canceling another file stays in Downloads', async() => {
      await editor.getByLabel('标题', { exact: true }).fill('保留草稿')
      await rightClick('alpha-song')
      await menu().click()
      await title('保留草稿')
      await rightClick('beta-song')
      await menu().click()
      await page.getByRole('button', { name: '继续编辑', exact: true }).click()
      assert.ok(page.url().includes('/download'))
      await rightClick('alpha-song')
      await menu().click()
      await title('保留草稿')
    })
    await t.test('a file removed during the discard prompt keeps the previous draft intact', async() => {
      await rightClick('beta-song')
      await menu().click()
      await page.getByRole('button', { name: '放弃并打开', exact: true }).waitFor()
      await fs.unlink(betaPath)
      await page.getByRole('button', { name: '放弃并打开', exact: true }).click()
      await dismiss('文件不存在或已移动，请重新选择文件。')
      assert.ok(page.url().includes('/download'))
      await rightClick('alpha-song')
      await menu().click()
      await title('保留草稿')
      await editor.getByRole('button', { name: '还原修改', exact: true }).click()
      await fs.writeFile(betaPath, betaBytes)
    })
    await t.test('unfinished, restarted and unsupported downloads cannot launch an editor', async() => {
      for (const id of ['unfinished-song', 'restarted-song', 'unsupported-song']) {
        await rightClick(id)
        assert.notEqual(await menu().getAttribute('disabled'), null)
        await page.keyboard.press('Escape')
      }
    })
    await t.test('missing files, directories and files deleted after the menu opens report clear errors', async() => {
      await rightClick('missing-song')
      await menu().click()
      await dismiss('文件不存在或已移动，请重新选择文件。')
      assert.ok(page.url().includes('/download'))
      await rightClick('directory-song')
      await menu().click()
      await dismiss('无法读取此音频文件，文件可能损坏或格式与扩展名不一致。')
      await rightClick('beta-song')
      await fs.unlink(betaPath)
      await menu().click()
      await dismiss('文件不存在或已移动，请重新选择文件。')
      await fs.writeFile(betaPath, betaBytes)
    })
    await t.test('row reordering uses the clicked ID, and a removed task cannot open another row', async() => {
      await rightClick('alpha-song')
      await page.evaluate(async() => { (await window.__lxPluginHost.downloadFiles.getDownloads()).reverse() })
      await menu().click()
      await title('通过下载右键修改')
      await rightClick('beta-song')
      const removed = await page.evaluate(async() => {
        const list = await window.__lxPluginHost.downloadFiles.getDownloads()
        return JSON.parse(JSON.stringify(list.splice(list.findIndex(item => item.id === 'beta-song'), 1)[0]))
      })
      await menu().click()
      await dismiss('下载记录已删除，请刷新下载列表，或直接选择音频文件。')
      await page.evaluate(async task => { (await window.__lxPluginHost.downloadFiles.getDownloads()).push(task) }, removed)
    })
    await t.test('grouped download directories resolve moved files, while ambiguous names are rejected', async() => {
      const groupedPath = await page.evaluate(async() => {
        window.lxData.appSetting['download.isSavePathGroupByListName'] = true
        const task = (await window.__lxPluginHost.downloadFiles.getDownloads()).find(item => item.id === 'beta-song')
        return window.__lxPluginHost.downloadFiles.getDownloadSavePaths(task)[0]
      })
      assert.ok(path.resolve(groupedPath).startsWith(path.resolve(output) + path.sep))
      await fs.mkdir(groupedPath, { recursive: true })
      const movedFile = path.join(groupedPath, path.basename(betaPath))
      await fs.rename(betaPath, movedFile)
      await rightClick('beta-song')
      await menu().click()
      await title('Beta')
      assert.ok((await editor.innerText()).includes(movedFile))
      await page.evaluate(async() => {
        const task = (await window.__lxPluginHost.downloadFiles.getDownloads()).find(item => item.id === 'beta-song')
        task.metadata.filePath = ''
      })
      await fs.writeFile(betaPath, flac(['TITLE=Different song']).bytes)
      await rightClick('beta-song')
      await menu().click()
      await dismiss('下载目录中找到多个同名文件，请通过“选择音频文件”确认要编辑的文件。')
      await fs.unlink(betaPath)
      await fs.rename(movedFile, betaPath)
      await page.evaluate(async filePath => {
        window.lxData.appSetting['download.isSavePathGroupByListName'] = false
        ;(await window.__lxPluginHost.downloadFiles.getDownloads()).find(item => item.id === 'beta-song').metadata.filePath = filePath
      }, betaPath)
    })
    await t.test('saving rechecks task completion and detects deletion after the editor opened', async() => {
      await rightClick('beta-song')
      await menu().click()
      await title('Beta')
      await editor.getByLabel('标题', { exact: true }).fill('不可写入')
      await page.evaluate(async() => { (await window.__lxPluginHost.downloadFiles.getDownloads()).find(item => item.id === 'beta-song').status = 'run' })
      await editor.getByRole('button', { name: '保存标签', exact: true }).click()
      await editor.getByRole('alert').filter({ hasText: '歌曲尚未下载完成' }).waitFor()
      assert.deepEqual(await fs.readFile(betaPath), betaBytes)
      await page.evaluate(async() => { (await window.__lxPluginHost.downloadFiles.getDownloads()).find(item => item.id === 'beta-song').status = 'completed' })
      await fs.unlink(betaPath)
      await editor.getByRole('button', { name: '保存标签', exact: true }).click()
      await editor.getByRole('alert').filter({ hasText: '文件不存在或已移动' }).waitFor()
      assert.equal(await editor.getByLabel('标题', { exact: true }).inputValue(), '不可写入')
      await assert.rejects(fs.stat(betaPath), { code: 'ENOENT' })
    })
    await t.test('uninstall removes the right-click action immediately', async() => {
      await openStore(page)
      await uninstall(page, 'audio-tag-editor')
      await rightClick('alpha-song')
      assert.equal(await menu().count(), 0)
    })
    assert.deepEqual(errors, [])
    console.log('Download tag editor screenshots:', output)
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'download-tag-failure.png') }).catch(() => {})
    console.error('Download tag editor diagnostics:', output)
    throw error
  } finally { await app.close() }
})
