const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')
const invoke = (page, name, params) => page.evaluate(({ name, params }) => require('electron').ipcRenderer.invoke(name, params), { name, params })
const saved = page => invoke(page, 'winMain_get_data', 'playInfo')
const read = page => page.evaluate(() => ({ ids: window.lxData.playQueueList.map(item => item.musicInfo.id), index: window.lxData.playInfo.playerPlayIndex, current: window.lxData.playMusicInfo.musicInfo?.id ?? null }))
const poll = async(read, check) => {
  const start = Date.now()
  while (!check(await read())) {
    if (Date.now() - start > 10000) throw Error('Playback queue did not settle')
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

test('A03/A04: queue drag, keyboard move, save, restart and clear work in the production UI', { timeout: 120000 }, async t => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') }), page = f.page
  const profilePath = f.output
  const label = key => page.evaluate(key => window.i18n.t(key), key)
  const openQueue = async() => {
    await page.getByRole('button', { name: await label('player__play_list'), exact: true }).click()
    await page.locator('[data-play-queue]').waitFor()
  }
  try {
    page.setDefaultTimeout(8000)
    const audioFile = path.join(profilePath, 'fixture.wav')
    const samples = 8000 * 100, bytes = Buffer.alloc(44 + samples * 2)
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
    bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
    bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40); await fs.writeFile(audioFile, bytes)
    await page.evaluate(audioFile => {
      window.lxData.updateSetting({ 'player.startupAutoPlay': false, 'player.isSavePlayTime': true, 'player.autoSkipOnError': false })
      const entries = ['a', 'insert', 'b', 'a', 'c'].map(id => ({
        musicInfo: { id, name: `Queue ${id}`, singer: 'Queue test', source: 'local', interval: '01:40', meta: { songId: audioFile, filePath: audioFile, ext: 'wav', albumName: 'Queue', picUrl: '' } },
        listId: id === 'insert' ? null : 'deleted-source', isTempPlay: false,
      }))
      window.lxData.playQueueList.splice(0, window.lxData.playQueueList.length, ...entries)
      Object.assign(window.lxData.playInfo, { playerListId: '@play_queue', playerPlayIndex: 2, playIndex: -1 })
      Object.assign(window.lxData.playMusicInfo, entries[2])
      Object.assign(window.lxData.musicInfo, { id: 'b', name: 'Queue b', singer: 'Queue test' })
      window.app_event.setProgress(37, 100)
    }, audioFile)
    await poll(() => saved(page), value => value?.queue?.items.length === 5)

    await t.test('native dragging preserves the current song and saves the new order', async() => {
      await openQueue()
      const from = page.locator('[data-queue-index="0"] [draggable]')
      const target = page.locator('[data-queue-index="4"]')
      const box = await target.boundingBox()
      await from.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height - 3 } })
      await poll(() => read(page), value => value.ids.join() === 'insert,b,a,c,a')
      assert.deepEqual(await read(page), { ids: ['insert', 'b', 'a', 'c', 'a'], current: 'b', index: 1 })
      await poll(() => saved(page), value => value.queue.items[0].musicInfo.id === 'insert')
    })
    await t.test('keyboard ordering does not restart playback', async() => {
      await page.locator('[data-queue-index="0"] [draggable]').focus()
      await page.keyboard.press('Alt+ArrowDown')
      await poll(() => read(page), value => value.ids.join() === 'b,insert,a,c,a')
      await page.waitForFunction(() => document.activeElement.closest('[data-queue-index]')?.dataset.queueIndex === '1')
      await page.keyboard.press('Alt+ArrowDown')
      await poll(() => read(page), value => value.ids.join() === 'b,a,insert,c,a')
      await page.waitForFunction(() => document.activeElement.closest('[data-queue-index]')?.dataset.queueIndex === '2')
      await page.keyboard.press('Alt+ArrowUp')
      await poll(() => read(page), value => value.ids.join() === 'b,insert,a,c,a')
      assert.equal((await read(page)).current, 'b')
      assert.equal((await read(page)).index, 0)
      await page.screenshot({ path: path.join(profilePath, 'queue-order.png') })
    })
    let listId
    await t.test('save creates a playlist in queue order and preserves local file paths', async() => {
      await page.getByRole('button', { name: await label('player__queue_save'), exact: true }).click()
      await page.getByRole('textbox', { name: await label('lists__new_list_input'), exact: true }).fill('Queue saved')
      await page.getByRole('button', { name: await label('btn_save'), exact: true }).click()
      await poll(() => invoke(page, 'player_list_get'), lists => lists.some(item => item.name === 'Queue saved'))
      listId = (await invoke(page, 'player_list_get')).find(item => item.name === 'Queue saved').id
      await poll(() => invoke(page, 'player_list_music_get', listId), list => list.length === 4)
      const songs = await invoke(page, 'player_list_music_get', listId)
      assert.deepEqual(songs.map(song => song.id), ['b', 'insert', 'a', 'c'])
      assert(songs.every(song => song.meta.filePath === audioFile))
    })
    await t.test('restart restores the actual queue, inserted entries, duplicate occurrence and progress', async() => {
      await poll(() => saved(page), value => value?.time === 37 && value.queue.index === 0)
      assert.deepEqual(f.errors, [])
      await f.app.close(); f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') }); page = f.page
      await poll(() => read(page), value => value.ids.join() === 'b,insert,a,c,a')
      assert.deepEqual(await read(page), { ids: ['b', 'insert', 'a', 'c', 'a'], current: 'b', index: 0 })
      await poll(() => saved(page), value => value.time === 37)
      assert.equal((await saved(page)).queue.items[1].listId, null)
      assert.equal((await invoke(page, 'player_list_music_get', listId)).length, 4)
    })
    await t.test('clearing the queue persists an empty session across another restart', async() => {
      await openQueue()
      await page.getByRole('button', { name: await label('player__play_list_clear'), exact: true }).click()
      await poll(() => saved(page), value => value.queue.items.length === 0 && value.queue.current === null)
      assert.deepEqual(f.errors, [])
      await f.app.close(); f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') }); page = f.page
      assert.deepEqual(await read(page), { ids: [], current: null, index: -1 })
      assert.deepEqual(f.errors, [])
    })
    t.diagnostic('Queue screenshot: ' + path.join(profilePath, 'queue-order.png'))
  } catch (error) {
    await page.screenshot({ path: path.join(profilePath, 'queue-failure.png'), timeout: 2000 }).catch(() => {})
    t.diagnostic(JSON.stringify({ profilePath, errors: f.errors, queue: await read(page).catch(() => null), saved: await saved(page).catch(() => null) }))
    throw error
  } finally { await f.app.close() }
})
