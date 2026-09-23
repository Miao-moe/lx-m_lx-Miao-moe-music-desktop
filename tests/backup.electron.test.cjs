const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const zlib = require('node:zlib')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const { song, task } = require('./helpers/webdav-fixture.cjs')
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke(name, params), { name, params })
const dataState = app => app.evaluate(async() => ({ settings: global.lx.appSetting, data: await global.lx.worker.dbService.backupRead() }))
const settingsPage = async page => { await route(page, '/setting?name=SettingBackup'); await page.locator('#backup_all').waitFor(); await settled(page) }
const selectFile = (app, filename, save = false) => app.evaluate(({ dialog }, { filename, save }) => {
  if (save) dialog.showSaveDialog = async() => ({ canceled: false, filePath: filename })
  else dialog.showOpenDialog = async() => ({ canceled: false, filePaths: [filename] })
}, { filename, save })

test('D01-D08: manual backup preview, selective restore, errors and persistence in the production UI', { timeout: 120000 }, async t => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = f.output, backupFile = path.join(profilePath, 'all.lxmc')
  let exported
  const label = key => f.page.evaluate(key => window.i18n.t(key), key)
  const notice = () => f.page.locator('[data-backup-notice]')
  try {
    f.page.setDefaultTimeout(8000)
    await f.app.evaluate(async(_, input) => {
      const require = process.mainModule.require.bind(process.mainModule)
      await global.lx.event_app.update_config({ 'common.langId': 'zh-cn', 'common.isAgreePact': true, 'common.showChangeLog': false, 'player.volume': 0.37, 'download.enable': true })
      await global.lx.event_list.list_data_overwrite({ defaultList: [input.song], loveList: [], tempList: [], userList: [{ id: 'saved-list', name: '备份歌单', locationUpdateTime: null, list: [input.song] }] })
      await global.lx.worker.dbService.downloadListReplace([input.task])
      await global.lx.worker.dbService.editedLyricAdd(input.song.id, { lyric: '[00:01] My lyric', tlyric: '[00:01] Translation' })
      const fs = require('node:fs/promises'), path = require('node:path')
      await fs.mkdir(path.join(global.lxDataPath, 'plugins/preferences'), { recursive: true })
      await fs.writeFile(path.join(global.lxDataPath, 'plugins/preferences/folia-lyrics.json'), JSON.stringify({ version: 1, enabled: false, mode: 'classic' }))
    }, { song: song('saved'), task: task('saved', true) })
    await settingsPage(f.page)
    await t.test('export remains busy until the complete file is committed', async() => {
      await selectFile(f.app, backupFile, true)
      await f.app.evaluate(() => {
        const require = process.mainModule.require.bind(process.mainModule)
        const fs = require('node:fs/promises'); global.__backupRename = fs.rename
        const barrier = new Promise(resolve => { global.__backupRelease = resolve })
        fs.rename = async(from, to) => { if (to.endsWith('all.lxmc')) await barrier; return global.__backupRename(from, to) }
      })
      await f.page.getByRole('button', { name: await label('setting__backup_all_export'), exact: true }).click()
      await f.page.getByRole('status').filter({ hasText: await label('setting__backup_working') }).waitFor()
      assert.equal(await f.page.getByRole('button', { name: await label('setting__backup_all_export'), exact: true }).isDisabled(), true)
      await assert.rejects(fs.access(backupFile), { code: 'ENOENT' })
      await f.app.evaluate(() => { global.__backupRelease(); process.mainModule.require('node:fs/promises').rename = global.__backupRename })
      await notice().filter({ hasText: await label('setting__backup_exported') }).waitFor()
      exported = JSON.parse(zlib.gunzipSync(await fs.readFile(backupFile)).toString())
      assert.equal(exported.type, 'allData_v3')
      assert.equal(exported.data.downloads[0].id, 'task_saved')
      assert.equal(exported.data.lyrics[0].lyric.tlyric, '[00:01] Translation')
      assert.equal(exported.data.plugins.preferences['folia-lyrics.json'].enabled, false)
    })
    await t.test('failed exports show an error and preserve an existing backup', async() => {
      const before = await fs.readFile(backupFile)
      await f.app.evaluate(() => {
        const require = process.mainModule.require.bind(process.mainModule)
        const fs = require('node:fs/promises'); global.__backupRename = fs.rename
        fs.rename = async(from, to) => { if (to.endsWith('all.lxmc')) throw Object.assign(Error('injected write failure'), { code: 'ENOSPC' }); return global.__backupRename(from, to) }
      })
      try {
        await f.page.getByRole('button', { name: await label('setting__backup_all_export'), exact: true }).click()
        await notice().filter({ hasText: await label('setting__backup_error_io') }).waitFor()
        assert.deepEqual(await fs.readFile(backupFile), before)
      } finally { await f.app.evaluate(() => { process.mainModule.require('node:fs/promises').rename = global.__backupRename }) }
    })
    await t.test('preview exposes contents and restores only checked playlists', async() => {
      await f.app.evaluate(async(_, current) => {
        await global.lx.event_list.list_data_overwrite({ defaultList: [current], loveList: [], tempList: [], userList: [] })
        await global.lx.event_app.update_config({ 'player.volume': 0.81 })
      }, song('current'))
      await selectFile(f.app, backupFile)
      await f.page.getByRole('button', { name: await label('setting__backup_all_import'), exact: true }).click()
      await f.page.locator('[data-backup-preview]').waitFor()
      assert.equal(await f.page.locator('[data-backup-section]').count(), 6)
      for (const section of ['settings', 'downloads', 'lyrics', 'plugins', 'library']) await f.page.locator(`[data-backup-section="${section}"] label`).first().click()
      const form = f.page.locator('[data-backup-preview]')
      for (const listId of ['default', 'love', 'temp']) await form.locator(`[data-backup-list="${listId}"] label`).click()
      await form.screenshot({ path: path.join(profilePath, 'backup-preview.png') })
      await form.getByRole('button', { name: await label('setting__backup_restore'), exact: true }).click()
      await notice().filter({ hasText: await label('setting__backup_restored') }).waitFor()
      const current = await dataState(f.app)
      assert.equal(current.settings['player.volume'], 0.81)
      assert.equal(current.data.playlists.find(list => list.id === 'default').list[0].id, 'wy_current')
      assert.equal(current.data.playlists.find(list => list.id === 'saved-list').list[0].id, 'wy_saved')
      await f.page.waitForFunction(() => window.lxData.userLists.some(list => list.id === 'saved-list'))
    })
    await t.test('cancelled and malformed imports cannot alter any data', async() => {
      const before = await dataState(f.app)
      await selectFile(f.app, backupFile)
      await f.page.getByRole('button', { name: await label('setting__backup_all_import'), exact: true }).click()
      await f.page.locator('[data-backup-preview]').getByRole('button', { name: await label('btn_cancel'), exact: true }).click()
      await f.page.locator('[data-backup-preview]').waitFor({ state: 'hidden' })
      assert.deepEqual(await dataState(f.app), before)
      const bad = path.join(profilePath, 'broken.json'); await fs.writeFile(bad, '{broken')
      await selectFile(f.app, bad)
      await f.page.getByRole('button', { name: await label('setting__backup_all_import'), exact: true }).click()
      await notice().filter({ hasText: await label('setting__backup_error_json') }).waitFor()
      assert.deepEqual(await dataState(f.app), before)
    })
    await t.test('settings disk failures reject IPC and retain committed memory and disk', async() => {
      const before = (await dataState(f.app)).settings['player.volume']
      await f.app.evaluate(() => {
        const require = process.mainModule.require.bind(process.mainModule)
        const fs = require('node:fs/promises'); global.__backupRename = fs.rename
        fs.rename = async(from, to) => { if (to.endsWith('config_v2.json')) throw Object.assign(Error('config write failed'), { code: 'ENOSPC' }); return global.__backupRename(from, to) }
      })
      try {
        await assert.rejects(invoke(f.page, 'common_set_app_setting', { 'player.volume': 0.01 }), /config write failed/)
        assert.equal((await dataState(f.app)).settings['player.volume'], before)
        const disk = await f.app.evaluate(async() => {
          const require = process.mainModule.require.bind(process.mainModule)
          return JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(global.lxDataPath, 'config_v2.json'), 'utf8')).setting['player.volume']
        })
        assert.equal(disk, before)
      } finally { await f.app.evaluate(() => { process.mainModule.require('node:fs/promises').rename = global.__backupRename }) }
    })
    await t.test('concurrent settings changes retain all fields in memory and on disk', async() => {
      await Promise.all([
        invoke(f.page, 'common_set_app_setting', { 'player.volume': 0.44 }),
        invoke(f.page, 'common_set_app_setting', { 'player.playbackRate': 1.25 }),
      ])
      const current = (await dataState(f.app)).settings
      assert.equal(current['player.volume'], 0.44)
      assert.equal(current['player.playbackRate'], 1.25)
      const disk = await f.app.evaluate(async() => {
        const require = process.mainModule.require.bind(process.mainModule)
        return JSON.parse(await require('node:fs/promises').readFile(require('node:path').join(global.lxDataPath, 'config_v2.json'), 'utf8')).setting
      })
      assert.equal(disk['player.volume'], 0.44)
      assert.equal(disk['player.playbackRate'], 1.25)
    })
    await t.test('restoring all supported categories refreshes downloads and survives restart', async() => {
      await f.app.evaluate(async() => {
        await global.lx.worker.dbService.downloadListReplace([])
        await global.lx.worker.dbService.editedLyricClear()
      })
      // Load the empty download cache before restoring it through the settings UI.
      await route(f.page, '/download'); await settled(f.page); await settingsPage(f.page)
      await selectFile(f.app, backupFile)
      await f.page.getByRole('button', { name: await label('setting__backup_all_import'), exact: true }).click()
      await f.page.locator('[data-backup-preview]').getByRole('button', { name: await label('setting__backup_restore'), exact: true }).click()
      await notice().filter({ hasText: await label('setting__backup_restored_restart') }).waitFor()
      const restored = await dataState(f.app)
      assert.equal(restored.settings['player.volume'], 0.37)
      assert.equal(restored.data.downloads.find(task => task.id === 'task_saved').status, 'completed')
      assert.equal(restored.data.lyrics[0].lyric.lyric, '[00:01] My lyric')
      await route(f.page, '/download'); await f.page.getByText(/^Song saved/).first().waitFor()
      assert.deepEqual(f.errors, [])
      await f.app.close(); f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      const restarted = await dataState(f.app)
      assert.equal(restarted.settings['player.volume'], 0.37)
      assert.equal(restarted.data.lyrics[0].lyric.tlyric, '[00:01] Translation')
      assert.equal(restarted.data.playlists.find(list => list.id === 'saved-list').list[0].id, 'wy_saved')
      assert.deepEqual(f.errors, [])
    })
    await t.test('startup recovers interrupted configuration files before loading settings', async() => {
      const root = await f.app.evaluate(() => global.lxDataPath)
      await f.app.close()
      const configPath = path.join(root, 'config_v2.json')
      const before = await fs.readFile(configPath, 'utf8')
      const interrupted = JSON.parse(before)
      interrupted.setting['player.volume'] = 0.02
      const journalPath = path.join(root, 'backup-restore-journal.json')
      await fs.writeFile(journalPath, JSON.stringify({ id: 'interrupted-before-commit', files: [{ name: 'config_v2.json', before }] }))
      await fs.writeFile(configPath, JSON.stringify(interrupted))
      f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      assert.equal((await dataState(f.app)).settings['player.volume'], 0.37)
      assert.equal(JSON.parse(await fs.readFile(configPath, 'utf8')).setting['player.volume'], 0.37)
      await assert.rejects(fs.access(journalPath), { code: 'ENOENT' })
      assert.deepEqual(f.errors, [])
    })
    t.diagnostic('Backup preview screenshot: ' + path.join(profilePath, 'backup-preview.png'))
  } finally { await f.app.close() }
})
