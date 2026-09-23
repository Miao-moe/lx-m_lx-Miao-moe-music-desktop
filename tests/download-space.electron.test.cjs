const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const invoke = (page, channel, params) => page.evaluate(({ channel, params }) => require('electron').ipcRenderer.invoke(channel, params), { channel, params })
const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#297c88"/></svg>')
const song = (id, size) => ({
  id, source: 'kw', name: `C20 ${id}`, singer: 'Fixture', interval: '03:00',
  meta: { songId: id, albumName: 'Fixture', picUrl: cover, qualitys: [{ type: '128k', size }], _qualitys: { '128k': { size } } },
})

test('C20: bulk download previews space, blocks the batch cap and starts only after confirmation', { timeout: 45000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page, errors, output } = fixture
  try {
    page.setDefaultTimeout(8000)
    const tracks = [song('c20-first', '2M'), song('c20-second', '3M')]
    await invoke(page, 'player_list_add', { position: 0, listInfos: [{ id: 'c20-list', name: 'C20 fixture', source: 'kw', sourceListId: 'fixture', locationUpdateTime: null }] })
    await invoke(page, 'player_list_music_overwrite', { listId: 'c20-list', musicInfos: tracks })
    await route(page, '/list?id=c20-list')
    await settled(page)
    await page.locator('#view .list-item').first().waitFor()
    const labels = await page.evaluate(() => ({
      start: window.i18n.t('download__space_start'),
      refresh: window.i18n.t('download__space_refresh'),
      overBatch: window.i18n.t('download__space_batch_exceeded'),
    }))
    await page.evaluate(savePath => {
      Object.assign(window.lxData.appSetting, {
        'download.savePath': savePath,
        'download.maxTaskSizeMiB': 0,
        'download.maxBatchSizeMiB': 4,
        'download.maxDownloadNum': 0,
      })
      const component = window.__motionComponents().find(item => item.type.name === 'MusicList' && 'selectedList' in item.setupState)
      component.setupState.selectedList.splice(0, 0, ...component.setupState.list)
      component.setupState.isShowDownloadMultiple = true
    }, output)
    const modal = page.locator('#view main').filter({ has: page.getByRole('button', { name: labels.start, exact: true }) })
    const start = modal.getByRole('button', { name: labels.start, exact: true })
    await modal.getByText(labels.overBatch, { exact: true }).waitFor()
    assert.equal(await start.isDisabled(), true)
    assert.match(await modal.textContent(), /5\.00 MB/)
    assert.equal((await invoke(page, 'winMain_download_list_get')).length, 0)
    await page.screenshot({ path: path.join(output, 'download-space-preflight.png') })
    await page.evaluate(() => { window.lxData.appSetting['download.maxBatchSizeMiB'] = 6 })
    await modal.getByRole('button', { name: labels.refresh, exact: true }).click()
    await start.waitFor({ state: 'visible' })
    await page.waitForFunction(label => {
      const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
      return button && !button.disabled
    }, labels.start)
    await start.click()
    await page.waitForFunction(async() => (await require('electron').ipcRenderer.invoke('winMain_download_list_get')).length === 2)
    const tasks = await invoke(page, 'winMain_download_list_get')
    assert.equal(tasks[0].batchId, tasks[1].batchId)
    assert.equal(tasks[0].batchLimitBytes, 6 * 1024 ** 2)
    assert.deepEqual(errors, [])
    const exited = new Promise(resolve => app.process().once('exit', resolve))
    await app.close()
    await exited
    fixture = await launch({ profilePath: output, rendererPath: path.resolve('dist/index.html') })
    const restored = await invoke(fixture.page, 'winMain_download_list_get')
    assert.equal(restored.length, 2)
    assert.equal(restored[0].batchId, restored[1].batchId)
    assert.equal(restored[0].batchLimitBytes, 6 * 1024 ** 2)
  } finally { await fixture.app.close() }
})
