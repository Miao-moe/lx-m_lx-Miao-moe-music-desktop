const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const song = id => ({
  id: 'mg_' + id, name: 'Fixture song ' + id, singer: 'Fixture', source: 'mg', interval: '03:40',
  meta: {
    songId: String(id), contentId: '6009190000017164' + id, copyrightId: 'copy' + id, albumName: 'Fixture', qualitys: [], _qualitys: {},
    picUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#297c88"/></svg>'),
  },
})

test('playlist writeback switch validates access, syncs edits, retries and persists through Electron IPC', { timeout: 65000 }, async t => {
  let name = 'Migu fixture', failWrite = false
  let tracks = [song(11)]
  const writes = []
  const server = http.createServer(async(req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    if (payload && failWrite) { res.writeHead(503); res.end(); return }
    let data
    if (req.url.includes('/home-page/')) data = { myCreatedMusicLists: { createdMusicLists: [{ musicListId: '123', title: name }] } }
    else if (req.url.includes('/playlist/song/')) data = { totalCount: tracks.length, songList: tracks.map(song => ({ songId: song.meta.songId, contentId: song.meta.contentId, copyrightId: song.meta.copyrightId })) }
    else if (payload) {
      writes.push(payload)
      if (payload.contentIds) for (const id of payload.contentIds) tracks.push(song(Number(id.slice(-2))))
      else if (payload.songflag === '2') tracks = tracks.filter(song => song.meta.contentId !== payload.contentId)
      else if (payload.songflag === '0') name = payload.title
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ code: '000000', data }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  try {
    fixture = await launch({ initializeMotion: false, rendererPath: path.resolve('dist/index.html') })
    const profilePath = fixture.output
    const { page } = fixture
    page.on('pageerror', error => { t.diagnostic(error.stack) })
    await invoke(page, 'player_list_add', { position: 0, listInfos: [
      { id: 'writeback-mg', name: 'Migu fixture', source: 'mg', sourceListId: '123', locationUpdateTime: null },
      { id: 'writeback-wy', name: 'NetEase fixture', source: 'wy', sourceListId: '123', locationUpdateTime: null },
      { id: 'writeback-kw', name: 'Kuwo fixture', source: 'kw', sourceListId: '123', locationUpdateTime: null },
    ] })
    await route(page, '/list?id=writeback-mg')
    await settled(page)
    const labels = await page.evaluate(() => Object.fromEntries(['list_update_modal__title', 'list_writeback__idle', 'list_writeback__success', 'list_writeback__failed', 'list_writeback__retry', 'list_writeback__error_login'].map(key => [key, window.i18n.t(key)])))
    await page.getByRole('button', { name: labels.list_update_modal__title, exact: true }).click()
    const row = page.locator('li').filter({ has: page.locator('#list_writeback_writeback-mg') })
    const checkbox = page.locator('#list_writeback_writeback-mg')
    const toggle = row.locator('label[for="list_writeback_writeback-mg"]')
    await toggle.waitFor()

    await t.test('default-off and unsupported switches; failed enable can be retried', async() => {
      assert.equal(await checkbox.isChecked(), false)
      assert.equal(await page.locator('#list_writeback_writeback-wy').isChecked(), false)
      assert.equal(await page.locator('#list_writeback_writeback-kw').isDisabled(), true)
      await page.locator('label[for="list_writeback_writeback-kw"] [role="checkbox"]').press('Space')
      assert.equal(await page.locator('#list_writeback_writeback-kw').isChecked(), false)
      await row.locator('label[for="list_auto_update_writeback-mg"]').click()
      assert.equal(await page.locator('#list_auto_update_writeback-mg').isChecked(), true)
      await row.locator('label[for="list_auto_update_writeback-mg"]').click()
      assert.equal(await page.locator('#list_auto_update_writeback-mg').isChecked(), false)
      await toggle.click()
      await row.getByText(labels.list_writeback__error_login, { exact: false }).waitFor()
      assert.equal(await checkbox.isChecked(), false)
      assert.equal(writes.length, 0)
    })

    // Route only the fixture's Migu requests to localhost; no real login or platform writes are used.
    await page.evaluate(port => {
      const https = require('https'), http = require('http')
      const original = https.request
      https.request = function(options, callback) {
        if ((options.hostname ?? options.host) === 'app.c.nf.migu.cn') {
          return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined }, callback)
        }
        return original.apply(this, arguments)
      }
      window.lxData.appSetting['cookie.mg'] = 'mg_auth_uid=7; mg_auth_pacmtoken=fixture-session'
    }, server.address().port)

    await t.test('enabling validates ownership and saves the switch without uploading prior differences', async() => {
      await toggle.click()
      await row.getByText(labels.list_writeback__idle, { exact: true }).waitFor()
      const saved = await invoke(page, 'winMain_get_data', 'playlistWriteback')
      assert.equal(saved.lists['writeback-mg'].enabled, true)
      assert.equal(saved.lists['writeback-mg'].ownerId, '7')
      assert.equal(writes.length, 0)
      assert.equal(await checkbox.isChecked(), true)
    })

    await t.test('normal list mutation broadcasts drive additions, removals and renames', async() => {
      await invoke(page, 'player_list_music_add', { id: 'writeback-mg', musicInfos: [song(12)], addMusicLocationType: 'bottom' })
      await row.getByText(labels.list_writeback__success, { exact: true }).waitFor()
      assert.deepEqual(tracks.map(song => song.meta.songId), ['11', '12'])
      assert.deepEqual(writes[0], { id: '123', contentIds: ['600919000001716412'] })
      await invoke(page, 'player_list_music_remove', { listId: 'writeback-mg', ids: ['mg_12'] })
      await invoke(page, 'player_list_update', [{ id: 'writeback-mg', name: 'Renamed fixture', source: 'mg', sourceListId: '123', locationUpdateTime: null }])
      await row.getByText(labels.list_writeback__success, { exact: true }).waitFor()
      assert.equal(name, 'Renamed fixture')
      assert.deepEqual(tracks.map(song => song.meta.songId), ['11'])
    })

    await t.test('a failed API request keeps edits and the manual retry completes them', async() => {
      failWrite = true
      await invoke(page, 'player_list_music_add', { id: 'writeback-mg', musicInfos: [song(13)], addMusicLocationType: 'bottom' })
      await row.getByText(labels.list_writeback__failed, { exact: true }).waitFor()
      assert((await invoke(page, 'player_list_music_get', 'writeback-mg')).some(song => song.id === 'mg_13'))
      failWrite = false
      await row.getByRole('button', { name: labels.list_writeback__retry, exact: true }).click()
      await row.getByText(labels.list_writeback__success, { exact: true }).waitFor()
      assert.deepEqual(tracks.map(song => song.meta.songId), ['11', '13'])
      await page.screenshot({ path: path.join(profilePath, 'playlist-writeback.png') })
      t.diagnostic('Screenshot: ' + path.join(profilePath, 'playlist-writeback.png'))
    })

    await toggle.click()
    await page.waitForFunction(() => !document.querySelector('#list_writeback_writeback-mg').checked)
    const saved = await invoke(page, 'winMain_get_data', 'playlistWriteback')
    assert.equal(saved.lists['writeback-mg'].enabled, false)
    assert.deepEqual(fixture.errors, [])
    await fixture.app.close()
    fixture = null
    fixture = await launch({ profilePath, initializeMotion: false, rendererPath: path.resolve('dist/index.html') })
    await t.test('the disabled switch and edited local songs survive a full restart', async() => {
      await route(fixture.page, '/list?id=writeback-mg')
      await fixture.page.getByRole('button', { name: labels.list_update_modal__title, exact: true }).click()
      await fixture.page.locator('#list_writeback_writeback-mg').waitFor({ state: 'attached' })
      assert.equal(await fixture.page.locator('#list_writeback_writeback-mg').isChecked(), false)
      const songs = await invoke(fixture.page, 'player_list_music_get', 'writeback-mg')
      assert.deepEqual(songs.map(song => song.id), ['mg_13'])
    })
    assert.deepEqual(fixture.errors, [])
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
