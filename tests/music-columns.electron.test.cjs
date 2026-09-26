const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#4daf7c"/></svg>')
const songs = count => Array.from({ length: count }, (_, index) => ({
  id: `column-song-${index}`,
  source: 'wy',
  name: `A long song title for checking ellipsis and column alignment ${index}`,
  singer: 'A long artist name',
  interval: '03:40',
  meta: { picUrl: cover, songId: `${index}`, albumName: 'An album with a long title', qualitys: [], _qualitys: {} },
}))
const settings = async(page, value) => {
  await page.evaluate(value => window.lxData.updateSetting(value), value)
  await page.waitForFunction(value => Object.entries(value).every(([key, expected]) => JSON.stringify(window.lxData.appSetting[key]) === JSON.stringify(expected)), value)
}
const seed = async(page, count = 50) => {
  await page.evaluate(list => {
    for (const component of window.__motionComponents()) {
      const state = component.setupState
      if (component.type.name === 'MusicList' && 'list' in state) state.list = list
      // Production script-setup state is private; seed its rendered list through reactive props.
      if (component.type.name === 'MaterialOnlineList') Object.assign(component.props, { list, noItem: '', total: list.length, page: 1, limit: 100 })
      if ('loadKey' in component.props) Object.assign(component.props, { loadKey: list, loading: false })
      for (const key of ['listInfo', 'listDetailInfo', 'entityDetailInfo']) {
        if (state[key] && Array.isArray(state[key].list)) {
          Object.assign(state[key], {
            key: 'column-fixture',
            list,
            total: list.length,
            limit: 100,
            page: 1,
            noItemLabel: '',
            info: { name: 'Column fixture', img: '', desc: '' },
          })
        }
      }
      if ('profileLoading' in state) state.profileLoading = false
    }
  }, songs(count))
  if (count) await page.locator('#view [data-music-cell="name"]').first().waitFor()
  await page.locator('#view [data-music-columns]').waitFor()
}
const widths = page => page.locator('#view [data-music-column]').evaluateAll(headers => headers.map(header => header.getBoundingClientRect().width))
const saved = page => page.evaluate(() => JSON.parse(window.lxData.appSetting['list.columnWidths']))
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`)
const alignment = async page => {
  await page.locator('#view [data-music-cell="name"]').first().waitFor()
  const geometry = await page.evaluate(() => {
    const row = document.querySelector('#view .list-item')
    const headers = [...document.querySelectorAll('#view [data-music-column]')]
    return headers.map(header => {
      const cell = row.querySelector(`[data-music-cell="${header.dataset.musicColumn}"]`)
      const head = header.getBoundingClientRect(); const body = cell.getBoundingClientRect()
      return { id: header.dataset.musicColumn, header: { x: head.x, width: head.width }, cell: { x: body.x, width: body.width }, font: window.getComputedStyle(cell).fontSize }
    })
  })
  for (const column of geometry) {
    near(column.header.x, column.cell.x, column.id + ' left edge')
    near(column.header.width, column.cell.width, column.id + ' width')
    assert.ok(column.header.width > 0, column.id + ' remains visible')
  }
  return geometry
}
const drag = async(page, id, delta, finish = true) => {
  const handle = await page.locator(`#view [data-column-resize="${id}"]`).boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 + delta, handle.y + handle.height / 2, { steps: 10 })
  if (finish) await page.mouse.up()
}
const reset = async page => {
  await page.locator('#view [data-column-resize="name"]').dblclick()
  await page.waitForFunction(() => {
    const key = document.querySelector('#view [data-music-columns]').dataset.musicColumns
    return !JSON.parse(window.lxData.appSetting['list.columnWidths'])[key]
  })
}

test('all song table headers resize with their rows and remember the selected layout', { timeout: 120000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  t.after(async() => { if (fixture) await fixture.app.close() })
  const { page, output } = fixture
  // Hold platform requests locally so late online results cannot replace the layout fixtures.
  const server = http.createServer(() => {})
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async() => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  })
  await page.evaluate(port => {
    const http = require('node:http')
    const https = require('node:https')
    const request = http.request
    const intercept = (options, callback) => request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined }, callback)
    http.request = intercept
    https.request = intercept
  }, server.address().port)
  page.setDefaultTimeout(7000)
  await settings(page, { 'common.langId': 'zh-cn', 'list.actionButtonsVisible': true, 'list.loadingMode': 'progressive', 'download.enable': true })
  await route(page, '/list?id=love')
  await settled(page)
  await seed(page)

  await t.test('every boundary adjusts columns without changing fonts or selecting a song', async() => {
    assert.equal(await page.locator('#view [data-column-resize]').count(), 6)
    const original = await alignment(page)
    for (const id of ['index', 'cover', 'name', 'singer', 'album', 'time']) {
      await reset(page)
      const handle = page.locator(`#view [data-column-resize="${id}"]`)
      const current = Number(await handle.getAttribute('aria-valuenow'))
      const minimum = Number(await handle.getAttribute('aria-valuemin'))
      const maximum = Number(await handle.getAttribute('aria-valuemax'))
      const delta = maximum - current > 12 ? Math.min(24, maximum - current) : -Math.min(24, current - minimum)
      assert.ok(Math.abs(delta) > 1, `${id} has room to resize`)
      const before = await widths(page)
      await drag(page, id, delta)
      await page.waitForFunction(() => !!JSON.parse(window.lxData.appSetting['list.columnWidths']).music)
      const after = await widths(page)
      const index = original.findIndex(column => column.id === id)
      near(after[index], before[index] + delta, id + ' follows the pointer')
      near(after.reduce((sum, width) => sum + width, 0), before.reduce((sum, width) => sum + width, 0), 'table width stays fixed')
      const result = await alignment(page)
      assert.deepEqual(result.map(column => column.font), original.map(column => column.font))
    }
    assert.equal(await page.locator('#view .list-item.active, #view .list-item.selected').count(), 0)
    await reset(page)
    await drag(page, 'name', 55)
    await page.waitForFunction(() => !!JSON.parse(window.lxData.appSetting['list.columnWidths']).music)
    await page.screenshot({ path: path.resolve('logs/music-columns-my-list.png') })
  })

  await t.test('cancel, empty lists, scrolling, responsive widths and keyboard adjustments remain usable', async() => {
    const before = await widths(page); const previous = await saved(page)
    await drag(page, 'singer', 30, false)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    ;(await widths(page)).forEach((width, index) => near(width, before[index], 'Escape restores widths'))
    assert.deepEqual(await saved(page), previous)
    await seed(page, 1)
    await alignment(page)
    await seed(page, 100)
    await page.locator('#view .music-column-scroll').evaluate(element => { element.scrollTop = 1800 })
    await alignment(page)
    await seed(page, 0)
    assert.equal(await page.locator('#view [data-column-resize]').count(), 6)
    await page.locator('#view [data-column-resize="album"]').press('ArrowLeft')
    await seed(page)
    await alignment(page)
    await page.locator('#view [data-column-resize="name"]').press('Home')
    const handle = page.locator('#view [data-column-resize="name"]')
    near(Number(await handle.getAttribute('aria-valuenow')), Number(await handle.getAttribute('aria-valuemin')), 'keyboard minimum')
    await handle.press('Shift+ArrowRight')
    near(Number(await handle.getAttribute('aria-valuenow')), Number(await handle.getAttribute('aria-valuemin')) + 1, 'keyboard fine adjustment')
    await reset(page)
    for (const [width, height, font] of [[828, 540, 19], [1280, 800, 14]]) {
      await page.setViewportSize({ width, height })
      await settings(page, { 'common.fontSize': font })
      await page.waitForTimeout(150)
      await alignment(page)
      await drag(page, 'index', 12)
      await alignment(page)
    }
    await page.setViewportSize({ width: 1114, height: 718 })
    await settings(page, { 'common.fontSize': 16 })
    await reset(page)
    await drag(page, 'name', 40)
    await page.waitForFunction(() => !!JSON.parse(window.lxData.appSetting['list.columnWidths']).music)
  })

  await t.test('search, playlists, charts, artists and albums share the song column layout', async() => {
    const previous = await saved(page)
    for (const url of [
      '/leaderboard?source=kw',
      '/search?source=kw&type=music&text=column-fixture',
      '/songList/detail?source=wy&id=column-fixture',
      '/search/entity/detail?source=wy&type=singer&id=column-fixture&name=Fixture',
      '/search/entity/detail?source=wy&type=album&id=column-fixture&name=Fixture',
    ]) {
      await route(page, url)
      await settled(page)
      await seed(page)
      assert.equal(await page.locator('#view [data-column-resize]').count(), 6, url)
      await alignment(page)
      assert.deepEqual(await saved(page), previous)
    }
    await page.screenshot({ path: path.resolve('logs/music-columns-online.png') })
    await settings(page, { 'list.actionButtonsVisible': false })
    await seed(page)
    assert.equal(await page.locator('#view [data-column-resize]').count(), 5)
    assert.equal(await page.locator('#view [data-music-cell="action"]').count(), 0)
    await drag(page, 'singer', 30)
    await page.waitForFunction(() => !!JSON.parse(window.lxData.appSetting['list.columnWidths']).musicCompact)
    await alignment(page)
    await settings(page, { 'list.actionButtonsVisible': true })
    await seed(page)
    assert.deepEqual((await saved(page)).music, previous.music)
    await alignment(page)
  })

  await t.test('download tasks and history have their own resizable columns', async() => {
    const previous = await saved(page)
    await page.evaluate(list => {
      const ipc = require('electron').ipcRenderer; const original = ipc.invoke.bind(ipc)
      ipc.invoke = async(channel, ...args) => channel === 'winMain_download_list_get' ? list : original(channel, ...args)
    }, songs(35).map((musicInfo, index) => ({
      id: `download-column-${index}`,
      status: index % 2 ? 'completed' : 'pause',
      statusText: index % 2 ? 'Completed' : 'Paused',
      progress: index % 2 ? 100 : 35,
      speed: 0,
      isComplate: !!(index % 2),
      metadata: { musicInfo, quality: '128k' },
    })))
    await route(page, '/download')
    await settled(page)
    await page.locator('#view [data-music-cell="name"]').first().waitFor()
    await alignment(page)
    await drag(page, 'progress', 35)
    await page.waitForFunction(() => !!JSON.parse(window.lxData.appSetting['list.columnWidths']).download)
    await alignment(page)
    assert.deepEqual((await saved(page)).music, previous.music)
    const download = (await saved(page)).download
    await page.evaluate(() => { window.__motionComponents().find(component => component.type.name === 'Download').setupState.activeTab = 'finished' })
    await page.locator('#view [data-music-cell="name"]').first().waitFor()
    await alignment(page)
    assert.deepEqual((await saved(page)).download, download)
    await page.screenshot({ path: path.resolve('logs/music-columns-download.png') })
    await drag(page, 'name', 20, false)
    await route(page, '/setting')
    await page.mouse.up()
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('music-column-resizing')), false)
  })

  const expected = await saved(page)
  assert.deepEqual(fixture.errors, [])
  const initial = fixture
  fixture = null
  await initial.app.close()
  const restored = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath: output })
  // The test is sequential; cleanup runs after all checks on the restarted app.
  // eslint-disable-next-line require-atomic-updates
  fixture = restored
  await t.test('column preferences survive a full application restart', async() => {
    assert.deepEqual(await saved(fixture.page), expected)
    await route(fixture.page, '/list?id=love')
    await settled(fixture.page)
    await seed(fixture.page)
    await alignment(fixture.page)
    await reset(fixture.page)
    const result = await saved(fixture.page)
    assert.equal(result.music, undefined)
    assert.deepEqual(result.download, expected.download)
    assert.deepEqual(result.musicCompact, expected.musicCompact)
  })
  assert.deepEqual(fixture.errors, [])
})
