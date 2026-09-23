const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const wav = () => {
  const data = Buffer.alloc(44 + 8000 * 2)
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40)
  return data
}
const rpc = (page, method, ...args) => page.evaluate(({ method, args }) => require('electron').ipcRenderer.invoke('winMain_library_action', { method, args }), { method, args })
const songs = (page, listId = 'one') => page.evaluate(listId => require('electron').ipcRenderer.invoke('player_list_music_get', listId), listId)
const choose = async(panel, label, option) => {
  const selection = panel.getByRole('combobox', { name: label })
  await selection.click()
  await selection.locator('..').locator('li').filter({ hasText: option }).click()
}

test('E10–E17: library controls work in the production renderer and persist', { timeout: 180000 }, async t => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = f.output
  const musicFolder = path.join(profilePath, 'audio')
  const movedFolder = path.join(profilePath, 'moved')
  await fs.mkdir(musicFolder); await fs.mkdir(movedFolder)
  const file = path.join(musicFolder, 'first.wav')
  await fs.writeFile(file, wav())
  try {
    f.page.setDefaultTimeout(12000)
    const initial = await f.page.evaluate(async file => {
      const [local] = (await window.lx.worker.main.createLocalMusicInfos([file])).musicInfos
      local.name = '本地测试'; local.singer = '歌手'; local.meta.albumName = '专辑'; local.meta.year = 2024
      const another = { ...local, id: 'missing', name: '失效的歌曲', meta: { ...local.meta, filePath: file + '.missing' } }
      await require('electron').ipcRenderer.invoke('player_list_data_overwire', { defaultList: [], loveList: [], tempList: [], userList: [{ id: 'one', name: '测试歌单', locationUpdateTime: null, list: [local, another] }, { id: 'smart', name: '智能测试', locationUpdateTime: null, list: [] }] })
      return [local, another]
    }, file)
    await rpc(f.page, 'captureListHistory', 'one', '手动保存')
    await f.page.evaluate(() => require('electron').ipcRenderer.invoke('player_list_music_remove', { listId: 'one', ids: ['missing'] }))
    await route(f.page, '/list?id=one'); await settled(f.page)
    const libraryEntry = f.page.locator('button[aria-label="歌单与本地曲库"]')
    assert.equal(await libraryEntry.isVisible(), false)
    await libraryEntry.evaluate(element => element.click())
    let panel = f.page.locator('[data-library-manager]')
    await panel.getByRole('button', { name: '保存分类', exact: true }).waitFor()

    await t.test('folders, tags and pins persist and update the sidebar', async() => {
      await panel.getByLabel('文件夹', { exact: true }).fill('工作')
      await panel.getByLabel('标签', { exact: true }).fill('学习, 纯音')
      await panel.locator('label[for="library_pinned"]').click()
      await panel.getByRole('button', { name: '保存分类', exact: true }).click()
      await panel.getByText('分类已保存', { exact: true }).waitFor()
      const prefs = await rpc(f.page, 'getLibraryPreferences')
      assert.deepEqual(prefs.lists.one, { folder: '工作', tags: ['学习', '纯音'], pinned: true })
    })
    await t.test('version comparison and restore are visible and preserve the current version', async() => {
      await panel.getByRole('button', { name: '歌单历史', exact: true }).click()
      await panel.getByRole('button', { name: '比较', exact: true }).first().click()
      await panel.getByText(/移除 1 首/).waitFor()
      await panel.getByRole('button', { name: '恢复此版本', exact: true }).click()
      await f.page.getByRole('button', { name: '恢复', exact: true }).click()
      await panel.getByText('已恢复歌单', { exact: true }).waitFor()
      assert.equal((await songs(f.page)).length, 2)
      assert((await rpc(f.page, 'getListHistory', 'one')).length >= 2)
    })
    await t.test('smart rules generate songs and exclude their own output', async() => {
      await panel.getByRole('button', { name: '智能歌单', exact: true }).click()
      await choose(panel, '目标歌单', '智能测试')
      await choose(panel, '歌曲来源', '测试歌单')
      await panel.getByRole('button', { name: '保存规则并更新', exact: true }).click()
      await f.page.getByRole('button', { name: '保存并更新', exact: true }).click()
      await panel.getByText('智能歌单已更新', { exact: true }).waitFor()
      assert.equal((await songs(f.page, 'smart')).length, 2)
      assert.equal((await rpc(f.page, 'getSmartPlaylist', { kind: 'recent', days: 30, sourceList: '' }, 'smart')).length, 2)
    })
    await t.test('local album, artist, year and missing-file filters return the right songs', async() => {
      await panel.getByRole('button', { name: '文件管理', exact: true }).click()
      await panel.getByRole('button', { name: '立即扫描与检查', exact: true }).click()
      await panel.getByText(/检查完成，1 首文件失效/).waitFor()
      await panel.getByRole('button', { name: '本地曲库', exact: true }).click()
      await choose(panel, '年份', '2024')
      await panel.getByText('共 2 首；每页 50 首。', { exact: true }).waitFor()
      await panel.locator('label[for="library_missing"]').click()
      await panel.getByText('共 1 首；每页 50 首。', { exact: true }).waitFor()
      assert.equal(await panel.getByText('文件失效', { exact: true }).count(), 1)
    })
    await t.test('dated listening search and statistics use the requested range', async() => {
      await f.app.evaluate(async(_electron, initial) => {
        await global.lx.worker.dbService.recordListening(initial[0], new Date('2026-09-01T12:00:00').getTime())
        await global.lx.worker.dbService.recordListening(initial[1], new Date('2026-09-02T12:00:00').getTime())
      }, initial)
      await panel.getByRole('button', { name: '听歌历史', exact: true }).click()
      await panel.getByLabel('从', { exact: true }).fill('2026-09-01')
      await panel.getByLabel('到', { exact: true }).fill('2026-09-01')
      await panel.getByRole('button', { name: '查询', exact: true }).click()
      await panel.getByText(/共播放 1 次、1 首歌曲/).waitFor()
      await f.page.screenshot({ path: path.join(profilePath, 'library-history.png') })
    })
    await t.test('folder watching imports new audio and relocation only chooses a unique match', async() => {
      const prefs = await rpc(f.page, 'getLibraryPreferences')
      prefs.folders = [{ path: musicFolder, listId: 'one', enabled: true }]
      await rpc(f.page, 'saveLibraryPreferences', prefs)
      await fs.writeFile(path.join(musicFolder, 'second.wav'), wav())
      let item
      const deadline = Date.now() + 20000
      while (!item && Date.now() < deadline) { item = (await songs(f.page)).find(song => song.name === 'second'); if (!item) await new Promise(resolve => setTimeout(resolve, 100)) }
      assert(item, 'watcher should import the new file')
      await fs.rename(item.meta.filePath, path.join(movedFolder, 'second.wav'))
      const plan = await f.page.evaluate(({ item, movedFolder }) => window.lx.worker.main.planLibraryRelocation([item], movedFolder), { item, movedFolder })
      assert.equal(plan.replacements.length, 1)
      assert.equal(plan.replacements[0].after.id, item.id)
      await fs.mkdir(path.join(movedFolder, 'duplicate')); await fs.writeFile(path.join(movedFolder, 'duplicate', 'second.wav'), wav())
      const ambiguous = await f.page.evaluate(({ item, movedFolder }) => window.lx.worker.main.planLibraryRelocation([item], movedFolder), { item, movedFolder })
      assert.equal(ambiguous.replacements.length, 0); assert.equal(ambiguous.unresolved.length, 1)
      await fs.unlink(path.join(movedFolder, 'duplicate', 'second.wav'))
      await f.app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [folder] }) }, movedFolder)
      await panel.getByRole('button', { name: '文件管理', exact: true }).click()
      await panel.getByRole('button', { name: '选择新文件夹并预览', exact: true }).click()
      await panel.getByText(/可重新关联 1 首/).waitFor()
      await panel.getByRole('button', { name: '确认重新关联', exact: true }).click()
      await f.page.waitForFunction(() => !document.querySelector('[data-library-manager] [aria-busy=true]'))
      assert((await panel.textContent()).includes('歌曲路径已更新'), await panel.textContent())
      assert.equal((await songs(f.page)).find(song => song.id === item.id).meta.filePath, path.join(movedFolder, 'second.wav'))
    })
    await t.test('cache usage and clear controls are available without clearing user data', async() => {
      await panel.getByRole('button', { name: '关闭', exact: true }).click()
      await route(f.page, '/setting'); await settled(f.page)
      await f.page.locator('[data-setting-tab="SettingOther"]').click()
      const cache = f.page.locator('[data-cache-manager]')
      await cache.getByRole('button', { name: '刷新占用', exact: true }).click()
      await cache.getByRole('button', { name: '清理全部缓存', exact: true }).click()
      await f.page.waitForFunction(() => !document.querySelector('[data-cache-manager] button[disabled]'))
      assert.equal(await cache.getByRole('alert').count(), 0)
      assert.equal((await rpc(f.page, 'getListeningHistory')).stats.plays, 2)
      assert((await songs(f.page)).length >= 3)
    })
    const prefs = await rpc(f.page, 'getLibraryPreferences'); prefs.folders = []; await rpc(f.page, 'saveLibraryPreferences', prefs)
    assert.deepEqual(f.errors, [])
    await f.app.close()
    f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
    await t.test('organization and listening history survive a restart', async() => {
      assert.equal((await rpc(f.page, 'getLibraryPreferences')).lists.one.folder, '工作')
      assert.equal((await rpc(f.page, 'getListeningHistory')).stats.plays, 2)
    })
    assert.deepEqual(f.errors, [])
    console.log('Library UI evidence: ' + profilePath)
  } finally { await f.app.close() }
})
