const assert = require('node:assert/strict')
const { createDecipheriv, createHash } = require('node:crypto')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')
const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const song = id => ({
  id: 'wy_' + id,
  name: 'Fixture song ' + id,
  singer: 'Fixture',
  source: 'wy',
  interval: '03:40',
  meta: { songId: id, albumName: 'Fixture', qualitys: [], _qualitys: {}, picUrl: '' },
})

test('NetEase client login enables writeback and authenticates edits through encrypted Electron requests', { timeout: 65000 }, async() => {
  let name = 'NetEase fixture'
  let expired = false
  let tracks = ['11', '12']
  const writes = []
  const errors = []
  const server = http.createServer(async(req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      res.setHeader('Content-Type', 'application/json')
      // This client session is valid only on the client API, reproducing the reported false expiry.
      if (!req.url.startsWith('/eapi/')) {
        res.end(JSON.stringify({ code: 200, account: null, profile: null }))
        return
      }
      const form = new URLSearchParams(Buffer.concat(chunks).toString())
      const decipher = createDecipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8'), null)
      const decrypted = Buffer.concat([decipher.update(Buffer.from(form.get('params'), 'hex')), decipher.final()]).toString()
      const [api, json, digest] = decrypted.split('-36cd479b6b5-')
      assert.equal(api, req.url.replace('/eapi/', '/api/'))
      assert.equal(digest, createHash('md5').update('nobody' + api + 'use' + json + 'md5forencrypt').digest('hex'))
      const data = JSON.parse(json)
      assert.equal(data.header.MUSIC_U, 'fixture-client-session')
      assert.equal(data.header.__csrf, 'fixture-csrf')
      assert(req.headers.cookie.includes('MUSIC_U=fixture-client-session'))
      if (expired) { res.end(JSON.stringify({ code: 301 })); return }
      let body = { code: 200 }
      if (api.endsWith('/account/get')) body.account = { id: 7 }
      else if (api.endsWith('/playlist/detail')) {
        body.playlist = { name, creator: { userId: 7 }, specialType: 0, trackCount: tracks.length, trackIds: tracks.map(id => ({ id })) }
      } else if (api.endsWith('/playlist/manipulate/tracks')) {
        const ids = JSON.parse(data.trackIds)
        writes.push({ op: data.op, ids })
        assert.equal(data.pid, '123')
        if (data.op === 'add') tracks.push(...ids)
        else if (data.op === 'del') tracks = tracks.filter(id => !ids.includes(id))
        else if (data.op === 'update') tracks = ids
        else assert.fail('Unexpected playlist operation')
      } else if (api.endsWith('/playlist/update/name')) {
        assert.equal(data.id, '123')
        writes.push({ name: data.name })
        name = data.name
      } else assert.fail('Unexpected endpoint')
      res.end(JSON.stringify(body))
    } catch (error) {
      errors.push(error.message)
      res.writeHead(500)
      res.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  try {
    fixture = await launch({ initializeMotion: false, rendererPath: path.resolve('dist/index.html') })
    const { page } = fixture
    await page.evaluate(port => {
      const https = require('https')
      const http = require('http')
      const original = https.request
      https.request = function(options, callback) {
        if (['interfacepc.music.163.com', 'music.163.com'].includes(options.hostname ?? options.host)) {
          return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined }, callback)
        }
        return original.apply(this, arguments)
      }
      window.lxData.appSetting['cookie.wy'] = 'MUSIC_U=fixture-client-session; __csrf=fixture-csrf'
    }, server.address().port)
    await invoke(page, 'player_list_add', {
      position: 0,
      listInfos: [
        { id: 'writeback-wy-client', name, source: 'wy', sourceListId: '123', locationUpdateTime: null },
      ],
    })
    await invoke(page, 'player_list_music_add', { id: 'writeback-wy-client', musicInfos: [song(11), song(12)], addMusicLocationType: 'bottom' })
    await route(page, '/list?id=writeback-wy-client')
    await settled(page)
    const labels = await page.evaluate(() => Object.fromEntries(['list_update_modal__title', 'list_writeback__idle', 'list_writeback__success', 'list_writeback__error_login'].map(key => [key, window.i18n.t(key)])))
    await page.getByRole('button', { name: labels.list_update_modal__title, exact: true }).click()
    const row = page.locator('li').filter({ has: page.locator('#list_writeback_writeback-wy-client') })
    await row.locator('label[for="list_writeback_writeback-wy-client"]').click()
    await row.getByText(labels.list_writeback__idle, { exact: true }).waitFor()
    assert.equal(await page.locator('#list_writeback_writeback-wy-client').isChecked(), true)
    const saved = await invoke(page, 'winMain_get_data', 'playlistWriteback')
    assert.equal(saved.lists['writeback-wy-client'].ownerId, '7')
    assert(!JSON.stringify(saved).includes('fixture-client-session'))
    assert.deepEqual(writes, [])

    await invoke(page, 'player_list_music_add', { id: 'writeback-wy-client', musicInfos: [song(13)], addMusicLocationType: 'bottom' })
    await row.getByText(labels.list_writeback__success, { exact: true }).waitFor()
    assert.deepEqual(tracks, ['11', '12', '13'])
    assert.deepEqual(writes[0], { op: 'add', ids: ['13'] })

    await invoke(page, 'player_list_music_remove', { listId: 'writeback-wy-client', ids: ['wy_11'] })
    await invoke(page, 'player_list_update', [{ id: 'writeback-wy-client', name: 'Renamed fixture', source: 'wy', sourceListId: '123', locationUpdateTime: null }])
    await row.getByText(labels.list_writeback__success, { exact: true }).waitFor()
    assert.deepEqual(tracks, ['12', '13'])
    assert.equal(name, 'Renamed fixture')

    expired = true
    const writeCount = writes.length
    await invoke(page, 'player_list_music_add', { id: 'writeback-wy-client', musicInfos: [song(14)], addMusicLocationType: 'bottom' })
    await row.getByText(labels.list_writeback__error_login, { exact: false }).waitFor()
    assert.equal(writes.length, writeCount)
    assert((await invoke(page, 'player_list_music_get', 'writeback-wy-client')).some(song => song.id === 'wy_14'))
    assert.deepEqual(errors, [])
    assert.deepEqual(fixture.errors, [])
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
