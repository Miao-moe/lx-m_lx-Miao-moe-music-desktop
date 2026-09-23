const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const rpc = (page, method, ...args) => page.evaluate(({ method, args }) => require('electron').ipcRenderer.invoke('winMain_library_action', { method, args }), { method, args })
const songs = page => page.evaluate(() => require('electron').ipcRenderer.invoke('player_list_music_get', 'default'))

test('playlist tags move to the context menu and listening history replaces the trial list', { timeout: 120000 }, async() => {
  let f = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = f.output
  const first = { id: 'wy_first', name: '历史歌曲一', singer: '测试歌手', source: 'wy', interval: '03:00', meta: { songId: 'first' } }
  const second = { ...first, id: 'wy_second', name: '历史歌曲二', meta: { songId: 'second' } }
  try {
    f.page.setDefaultTimeout(12000)
    await f.page.evaluate(async song => {
      await require('electron').ipcRenderer.invoke('player_list_data_overwire', {
        defaultList: [song], loveList: [], tempList: [],
        userList: [{ id: 'one', name: '测试歌单', locationUpdateTime: null, list: [song] }],
      })
    }, first)
    await route(f.page, '/list?id=one')
    await settled(f.page)
    assert.equal(await f.page.getByRole('button', { name: '曲库管理' }).count(), 0)
    assert.equal(await f.page.locator('#my-list .default-list[aria-label="听歌历史"]').count(), 1)
    assert.equal(await f.page.locator('#my-list .default-list[aria-label="试听列表"]').count(), 0)

    await f.page.locator('#my-list .user-list[data-id="one"]').click({ button: 'right' })
    await f.page.getByRole('tab', { name: '编辑标签' }).click()
    const modal = f.page.locator('[data-playlist-tags-modal]')
    await modal.getByLabel('标签').fill('学习，收藏, 学习')
    await modal.getByRole('button', { name: '确定' }).click()
    await f.page.waitForFunction(() => document.querySelector('#my-list .user-list[data-id="one"]')?.textContent.includes('学习 / 收藏'))
    assert.deepEqual((await rpc(f.page, 'getLibraryPreferences')).lists.one.tags, ['学习', '收藏'])

    await f.app.evaluate(async(_electron, tracks) => {
      await global.lx.worker.dbService.recordListening(tracks[0], new Date('2026-09-01T12:00:00').getTime())
      await global.lx.worker.dbService.recordListening(tracks[1], new Date('2026-09-02T12:00:00').getTime())
    }, [first, second])
    await f.page.locator('#my-list .default-list[aria-label="听歌历史"]').click()
    await f.page.locator('[data-listening-history]').waitFor()
    await f.page.locator('#my-list .user-list[data-id="one"]').click({ button: 'right' })
    await f.page.getByRole('tab', { name: '编辑标签' }).click()
    await f.page.locator('[data-playlist-tags-modal]').getByRole('button', { name: '取消' }).click()
    await f.page.locator('[data-playlist-tags-modal]').waitFor({ state: 'hidden' })
    assert.equal(await f.page.locator('[data-listening-history] li').count(), 2)
    await f.page.screenshot({ path: path.join(profilePath, 'listening-history.png') })
    await f.page.getByLabel('从', { exact: true }).fill('2026-09-01')
    await f.page.getByLabel('到', { exact: true }).fill('2026-09-01')
    await f.page.locator('[data-listening-history]').getByRole('button', { name: '查询' }).click()
    await f.page.getByText(/共播放 1 次/).waitFor()
    assert.equal(await f.page.locator('[data-listening-history] li').count(), 1)

    await f.page.evaluate(() => window.i18n.setLanguage('en-us'))
    await f.page.getByRole('heading', { name: 'Listening history' }).waitFor()
    assert.equal(await f.page.locator('#my-list .default-list[aria-label="Listening history"]').count(), 1)
    await f.page.evaluate(() => window.i18n.setLanguage('zh-cn'))
    assert.equal((await songs(f.page)).length, 1, 'former trial-list data should not be erased')
    assert.deepEqual(f.errors, [])

    await f.app.close()
    f = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
    assert.deepEqual((await rpc(f.page, 'getLibraryPreferences')).lists.one.tags, ['学习', '收藏'])
    assert.equal((await rpc(f.page, 'getListeningHistory')).stats.plays, 2)
    await route(f.page, '/list?id=history')
    await f.page.locator('[data-listening-history]').getByRole('button', { name: '清空历史' }).click()
    await f.page.getByRole('button', { name: '清空历史' }).last().click()
    await f.page.waitForFunction(() => document.querySelector('[data-listening-history]')?.textContent.includes('共播放 0 次'))
    assert.equal((await rpc(f.page, 'getListeningHistory')).stats.plays, 0)
    assert.deepEqual(f.errors, [])
    console.log('Listening history UI evidence: ' + profilePath)
  } finally { await f.app.close() }
})
