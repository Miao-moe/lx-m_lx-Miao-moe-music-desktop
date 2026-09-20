const assert = require('node:assert/strict')
const path = require('node:path')
const net = require('node:net')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: ipc } = require('./helpers/load-typescript.cjs')()('src/common/ipcNames.ts')

test('playlist order, initial Open API volume and custom theme artwork survive an application restart', { timeout: 60000 }, async t => {
  let fixture = await launch({ initializeMotion: false, rendererPath: path.resolve('dist/index.html') })
  t.after(async() => { if (fixture) await fixture.app.close() })
  const output = fixture.output
  const expected = ['song-6', 'song-7', 'song-8', 'song-9', 'song-10', 'song-11']

  await t.test('adding and moving songs after deletions appends after the persisted tail', async() => {
    const state = await fixture.app.evaluate(async() => {
      const db = global.lx.worker.dbService
      const song = id => ({ id: 'song-' + id, name: 'Song ' + id, singer: 'Artist', source: 'wy', interval: '02:00', meta: { songId: id, albumName: 'Album', qualitys: [], _qualitys: {} } })
      const list = id => ({ id, name: id, source: null, sourceListId: null, locationUpdateTime: null })
      await db.createUserLists(-1, ['list-a', 'list-b', 'remove-c', 'remove-d', 'remove-e', 'list-f'].map(list))
      await db.removeUserLists(['remove-c', 'remove-d', 'remove-e'])
      await db.createUserLists(-1, [list('append-g'), list('append-h')])
      await db.musicOverwrite('list-a', Array.from({ length: 8 }, (_, i) => song(i)))
      await db.musicsRemove('list-a', Array.from({ length: 6 }, (_, i) => song(i).id))
      await db.musicsAdd('list-a', [song(8), song(9)], 'bottom')
      await db.musicOverwrite('list-b', [song(10), song(11)])
      await db.musicsMove('list-b', 'list-a', [song(10), song(11)], 'bottom')
      return { songs: (await db.getListMusics('list-a')).map(song => song.id), from: await db.getListMusics('list-b') }
    })
    assert.deepEqual(state.songs, expected)
    assert.deepEqual(state.from, [])
  })

  let backgroundUrl
  await t.test('saves a theme whose artwork path contains spaces, Chinese, parentheses, percent and hash', async() => {
    const filename = '背景 (test) #100%.png'
    const png = await fixture.page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 64
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#247b67'
      ctx.fillRect(0, 0, 64, 64)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    backgroundUrl = await fixture.app.evaluate(async({ app }, { filename, png }) => {
      const require = process.mainModule.require('module').createRequire(app.getAppPath() + '/package.json')
      const fs = require('node:fs/promises'), path = require('node:path')
      const dir = path.join(global.lxDataPath, 'theme_images')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, filename), Buffer.from(png, 'base64'))
      return require('node:url').pathToFileURL(path.join(dir, filename)).href
    }, { filename, png })
    await fixture.page.evaluate(async({ ipc, filename }) => {
      const { ipcRenderer } = require('electron')
      const info = await ipcRenderer.invoke(ipc.get_themes)
      const theme = JSON.parse(JSON.stringify(info.themes[0]))
      theme.id = 'upstream-theme-test'
      theme.name = 'Upstream test'
      theme.isCustom = true
      theme.config.extInfo['--background-image'] = filename
      await ipcRenderer.invoke(ipc.save_theme, theme)
      window.lxData.updateSetting({ 'theme.id': theme.id, 'player.volume': 0.37, 'player.isMute': true })
    }, { ipc, filename })
    assert.match(backgroundUrl, /^file:\/\//)
    await fixture.page.waitForFunction(() => window.lxData.appSetting['player.volume'] === 0.37)
  })

  await fixture.app.close()
  fixture = await launch({ profilePath: output, initializeMotion: false, rendererPath: path.resolve('dist/index.html') })

  await t.test('restarted database retains song order and assigns nonoverlapping list positions', async() => {
    const state = await fixture.app.evaluate(async({ app }) => {
      const require = process.mainModule.require('module').createRequire(app.getAppPath() + '/package.json')
      const service = global.lx.worker.dbService
      const songs = (await service.getListMusics('list-a')).map(song => song.id)
      // Read only this fixture's SQLite database to verify the persisted positions.
      const path = require('node:path')
      const Database = require(path.join(require('electron').app.getAppPath(), 'node_modules/better-sqlite3'))
      const db = new Database(path.join(global.lxDataPath, 'lx.data.db'), { readonly: true, fileMustExist: true })
      try {
        return { songs, positions: db.prepare('SELECT id, position FROM my_list ORDER BY position').all() }
      } finally { db.close() }
    })
    assert.deepEqual(state.songs, expected)
    const ids = state.positions.map(item => item.id)
    assert(ids.indexOf('append-g') > ids.indexOf('list-f'))
    assert(ids.indexOf('append-h') > ids.indexOf('append-g'))
    assert.equal(new Set(state.positions.map(item => item.position)).size, state.positions.length)
  })

  await t.test('saved theme background loads again at startup', async() => {
    const actual = await fixture.page.evaluate(async() => {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--background-image').trim()
      const image = new Image()
      image.src = value.slice(4, -1).replace(/^"|"$/g, '')
      await image.decode()
      return { url: image.src, width: image.naturalWidth }
    })
    assert.equal(actual.url, backgroundUrl)
    assert.equal(actual.width, 64)
  })

  await t.test('selecting the custom theme in settings applies its background immediately', async() => {
    await route(fixture.page, '/setting?name=SettingBasic')
    await fixture.page.locator('#basic_theme').waitFor()
    await fixture.page.evaluate(() => {
      const state = window.__motionComponents().find(c => typeof c.setupState.toggleTheme === 'function').setupState
      state.toggleTheme({ id: 'green' })
    })
    await fixture.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--background-image').trim() === 'none')
    await fixture.page.evaluate(() => {
      const state = window.__motionComponents().find(c => typeof c.setupState.toggleTheme === 'function').setupState
      state.toggleTheme({ id: 'upstream-theme-test' })
    })
    await fixture.page.waitForFunction(url => getComputedStyle(document.querySelector('#root')).backgroundImage.includes(url), backgroundUrl)
  })

  await t.test('Open API reports the saved volume and mute state before the user changes them', async() => {
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    const status = await fixture.page.evaluate(async({ channel, port }) => require('electron').ipcRenderer.invoke(channel, {
      action: 'enable', data: { enable: true, port: String(port), bindLan: false },
    }), { channel: ipc.open_api_action, port })
    assert.equal(status.status, true)
    const data = await fetch(`http://127.0.0.1:${port}/status?filter=volume,mute`).then(response => response.json())
    assert.equal(data.volume, 37)
    assert.equal(data.mute, true)
    await fixture.page.evaluate(channel => require('electron').ipcRenderer.invoke(channel, { action: 'enable', data: { enable: false } }), ipc.open_api_action)
  })
  assert.deepEqual(fixture.errors, [])
  t.diagnostic('Isolated restart verification: ' + output)
})
