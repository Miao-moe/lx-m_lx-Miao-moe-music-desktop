const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const song = id => ({ id, name: `歌曲 ${id}`, singer: '拖动排序测试', source: 'local', interval: '03:00', meta: { albumName: '测试专辑', filePath: '', ext: 'mp3', picUrl: '' } })
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke('player_' + name, params), { name, params })

test('playlist songs reorder by long press through the virtual list and persist', { timeout: 180000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let page = fixture.page
  const row = id => page.locator(`#my-list [data-song-id="${id}"]`)
  const viewport = () => page.locator('#my-list .music-column-scroll')
  const preview = () => page.locator('[data-song-drag-preview]')
  const read = async(id = 'drag') => (await invoke(page, 'list_music_get', id)).map(song => song.id)
  const waitOrder = async expected => {
    await page.waitForFunction(expected => {
      const c = window.__motionComponents().find(c => c.type.name === 'MusicList' && c.props.listId === 'drag')
      return JSON.stringify(c?.setupState.list.map(song => song.id)) === JSON.stringify(expected)
    }, expected)
    assert.deepEqual(await read(), expected)
  }
  const reset = async(ids = ['a', 'b', 'c', 'd', 'e'], buttons = true) => {
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await page.evaluate(buttons => { window.lxData.appSetting['list.actionButtonsVisible'] = buttons }, buttons)
    const trash = await invoke(page, 'list_trash_get')
    await invoke(page, 'list_trash_delete', trash.map(entry => entry.id))
    await invoke(page, 'list_data_overwire', {
      defaultList: [], loveList: [], tempList: [],
      userList: ['drag', 'other'].map(id => ({ id, name: `歌单 ${id}`, locationUpdateTime: null, list: ids.map(song) })),
    })
    await route(page, '/list?id=drag')
    await settled(page)
    await waitOrder(ids)
    await viewport().evaluate(el => { el.scrollTop = 0 })
    await page.waitForTimeout(250)
    await row(ids[0]).waitFor({ state: 'visible' })
    await page.evaluate(() => window.getSelection().removeAllRanges())
  }
  const hold = async id => {
    const box = await row(id).locator('[data-music-cell="name"]').boundingBox()
    assert(box)
    await page.mouse.move(box.x + 15, box.y + box.height / 2)
    await page.mouse.down()
    await preview().waitFor({ state: 'visible' })
  }
  const moveTo = async(id, fraction = 0.1) => {
    const box = await row(id).boundingBox()
    assert(box)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * fraction, { steps: 8 })
  }
  const release = async() => {
    await page.mouse.up()
    await preview().waitFor({ state: 'hidden' })
    assert.equal(await page.locator('body').evaluate(el => el.classList.contains('playlist-song-dragging')), false)
  }
  try {
    page.setDefaultTimeout(7000)
    for (const buttons of [true, false]) {
      await t.test(`both directions save the right IDs and the old menu is absent (buttons: ${buttons})`, async() => {
        await reset(undefined, buttons)
        await row('b').locator('[data-music-cell="index"]').click({ button: 'right' })
        const menu = page.locator('[role="toolbar"][aria-hidden="false"]')
        await menu.waitFor()
        const oldLabel = await page.evaluate(() => window.i18n.t('list__sort'))
        assert.equal(await menu.getByRole('tab', { name: oldLabel, exact: true }).count(), 0)
        await page.keyboard.press('Escape')
        await hold('b')
        await moveTo('e')
        await page.screenshot({ path: path.join(profilePath, 'song-drag-preview.png') })
        await release()
        await waitOrder(['a', 'c', 'd', 'b', 'e'])
        await hold('c')
        await moveTo('a')
        await release()
        await waitOrder(['c', 'a', 'd', 'b', 'e'])
        assert.equal(await page.evaluate(() => window.lxData.playMusicInfo.musicInfo?.id ?? null), null, 'drag must not play a song')
        assert.deepEqual(await invoke(page, 'list_trash_get'), [], 'reordering must not delete songs')
      })
    }

    await t.test('short clicks, movement before the hold delay and stationary holds do not reorder', async() => {
      await reset()
      const box = await row('b').boundingBox()
      await page.mouse.click(box.x + 12, box.y + 10)
      await page.mouse.move(box.x + 12, box.y + 10)
      await page.mouse.down()
      await moveTo('e')
      await page.waitForTimeout(550)
      assert.equal(await preview().count(), 0)
      await page.mouse.up()
      await hold('b')
      await release()
      await waitOrder(['a', 'b', 'c', 'd', 'e'])
      assert.equal(await page.evaluate(() => window.lxData.playMusicInfo.musicInfo?.id ?? null), null)
    })

    await t.test('Ctrl-selected songs move together in playlist order', async() => {
      await reset()
      for (const id of ['d', 'b']) await row(id).locator('[data-music-cell="index"]').click({ modifiers: ['Control'] })
      await hold('b')
      assert.equal(await page.locator('[data-song-dragging]').count(), 2)
      await moveTo('e', 0.9)
      await release()
      await waitOrder(['a', 'c', 'e', 'b', 'd'])
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.selectedList.length === 0)
    })

    await t.test('Escape, pointer cancellation, window blur and dropping outside cancel without saving', async() => {
      for (const action of ['escape', 'pointercancel', 'blur', 'outside']) {
        await reset()
        await hold('b')
        await moveTo('e')
        if (action === 'escape') await page.keyboard.press('Escape')
        else if (action === 'outside') await page.mouse.move(20, 20)
        else await page.evaluate(action => (action === 'blur' ? window : document).dispatchEvent(new Event(action)), action)
        await release()
        await waitOrder(['a', 'b', 'c', 'd', 'e'])
      }
    })

    await t.test('changing the playlist during a drag cancels stale candidates', async() => {
      await reset()
      await hold('b')
      await moveTo('e')
      await invoke(page, 'list_music_remove', { listId: 'drag', ids: ['b'] })
      await preview().waitFor({ state: 'hidden' })
      await release()
      await waitOrder(['a', 'c', 'd', 'e'])
      await reset()
      await hold('b')
      await route(page, '/list?id=other')
      await settled(page)
      await release()
      assert.deepEqual(await read('drag'), ['a', 'b', 'c', 'd', 'e'])
      assert.deepEqual(await read('other'), ['a', 'b', 'c', 'd', 'e'])
    })

    await t.test('edge scrolling crosses recycled rows and offsets do not corrupt the destination', async() => {
      const ids = Array.from({ length: 160 }, (_, i) => `song-${i}`)
      await reset(ids)
      const box = await viewport().boundingBox()
      await hold(ids[1])
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, { steps: 8 })
      await page.waitForFunction(() => document.querySelector('#my-list .music-column-scroll').scrollTop > 1000)
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const boundary = await viewport().evaluate(el => {
        const height = window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.listItemHeight
        return Math.round((el.scrollTop + el.clientHeight / 2) / height)
      })
      const expected = ids.filter(id => id !== ids[1])
      expected.splice(boundary - 1, 0, ids[1])
      await release()
      await waitOrder(expected)
      assert(await row(ids[0]).count() === 0, 'the original rows were recycled')

      await viewport().evaluate(el => {
        const height = window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.listItemHeight
        el.scrollTop = 90 * height
      })
      await page.waitForTimeout(250)
      await hold('song-95')
      await moveTo('song-92')
      await release()
      expected.splice(expected.indexOf('song-95'), 1)
      expected.splice(expected.indexOf('song-92'), 0, 'song-95')
      await waitOrder(expected)
      assert.deepEqual(await invoke(page, 'list_trash_get'), [])
    })

    await t.test('normal button clicks work and holding a song action button never starts a drag', async() => {
      await reset()
      const button = row('b').locator('[data-music-cell="action"] button').nth(1)
      const box = await button.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(550)
      assert.equal(await preview().count(), 0)
      await page.mouse.up()
      await page.waitForFunction(() => window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.isShowListAdd)
      const closeLabel = await page.evaluate(() => window.i18n.t('close'))
      await page.locator('#view').getByRole('button', { name: closeLabel, exact: true }).click()
      await page.waitForFunction(() => !window.__motionComponents().find(c => c.type.name === 'MusicList').setupState.isShowListAdd)
      await waitOrder(['a', 'b', 'c', 'd', 'e'])
    })

    await t.test('touch scroll stays available and a held touch can reorder', async() => {
      await reset(Array.from({ length: 80 }, (_, i) => `touch-${i}`))
      const session = await page.context().newCDPSession(page)
      await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      const touch = async(type, x, y) => session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }] })
      try {
        const box = await viewport().boundingBox()
        const x = box.x + box.width / 2
        await touch('touchStart', x, box.y + 230)
        await touch('touchMove', x, box.y + 100)
        await touch('touchEnd')
        await page.waitForFunction(() => document.querySelector('#my-list .music-column-scroll').scrollTop > 0)
        assert.equal(await preview().count(), 0)
        await reset()
        const source = await row('b').boundingBox()
        const target = await row('e').boundingBox()
        await touch('touchStart', source.x + 20, source.y + source.height / 2)
        await preview().waitFor({ state: 'visible' })
        await page.waitForTimeout(700)
        await row('b').dispatchEvent('contextmenu', { bubbles: true, cancelable: true })
        assert.equal(await preview().count(), 1, 'the touch long-press context menu must not cancel the drag')
        await touch('touchMove', target.x + 20, target.y + 2)
        await touch('touchEnd')
        await preview().waitFor({ state: 'hidden' })
        await waitOrder(['a', 'c', 'd', 'b', 'e'])
      } finally {
        await touch('touchCancel').catch(() => {})
        await session.send('Emulation.setTouchEmulationEnabled', { enabled: false })
        await session.detach()
      }
    })

    await t.test('the current song keeps its identity and gets its new playlist index', async() => {
      await reset()
      await page.evaluate(info => {
        Object.assign(window.lxData.playMusicInfo, { listId: 'drag', musicInfo: info, isTempPlay: false })
        Object.assign(window.lxData.playInfo, { playIndex: 1, playerListId: 'drag', playerPlayIndex: 1 })
      }, song('b'))
      await hold('b')
      await moveTo('e')
      await release()
      await waitOrder(['a', 'c', 'd', 'b', 'e'])
      await page.waitForFunction(() => window.lxData.playInfo.playIndex === 3)
      assert.equal(await page.evaluate(() => window.lxData.playMusicInfo.musicInfo.id), 'b')
      await page.evaluate(() => {
        Object.assign(window.lxData.playMusicInfo, { listId: null, musicInfo: null })
        Object.assign(window.lxData.playInfo, { playIndex: -1, playerListId: null, playerPlayIndex: -1 })
      })
    })

    await t.test('a failed save preserves the original order and the next drag can retry', async() => {
      await reset()
      await fixture.app.evaluate(({ app }) => {
        const require = process.mainModule.require('module').createRequire(app.getAppPath() + '/package.json')
        const Database = require('better-sqlite3')
        const db = new Database(require('node:path').join(global.lxDataPath, 'lx.data.db'))
        try {
          db.exec("CREATE TRIGGER fail_song_reorder BEFORE INSERT ON my_list_music_info_order BEGIN SELECT RAISE(ABORT, 'test save failure'); END")
        } finally { db.close() }
      })
      try {
        await hold('b')
        await moveTo('e')
        await release()
        const message = await page.evaluate(() => window.i18n.t('list__reorder_failed'))
        await page.getByText(message, { exact: true }).waitFor()
        await waitOrder(['a', 'b', 'c', 'd', 'e'])
      } finally {
        await fixture.app.evaluate(({ app }) => {
          const require = process.mainModule.require('module').createRequire(app.getAppPath() + '/package.json')
          const Database = require('better-sqlite3')
          const db = new Database(require('node:path').join(global.lxDataPath, 'lx.data.db'))
          try { db.exec('DROP TRIGGER fail_song_reorder') } finally { db.close() }
        })
      }
      await hold('b')
      await moveTo('e')
      await release()
      await waitOrder(['a', 'c', 'd', 'b', 'e'])
    })

    await t.test('saved order survives navigation and restarting the application', async() => {
      await route(page, '/list?id=other')
      await settled(page)
      await route(page, '/list?id=drag')
      await settled(page)
      await waitOrder(['a', 'c', 'd', 'b', 'e'])
      assert.deepEqual(fixture.errors, [])
      await fixture.app.close()
      fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
      page = fixture.page
      await route(page, '/list?id=drag')
      await settled(page)
      await waitOrder(['a', 'c', 'd', 'b', 'e'])
    })
    assert.deepEqual(fixture.errors, [])
    console.log('Drag screenshot:', path.join(profilePath, 'song-drag-preview.png'))
  } finally {
    await fixture.app.close()
  }
})
