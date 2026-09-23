const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { test } = require('node:test')
const { launch, route, settled } = require('./helpers/motion-fixture.cjs')

const makeWav = () => {
  const rate = 8000
  const buffer = Buffer.alloc(44 + rate * 60 * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40)
  return buffer
}
const hash = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex')

test('real untagged audio ignores online metadata while retaining local and edited lyrics', { timeout: 90000 }, async t => {
  const profilePath = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-local-metadata-'))
  const files = ['recording.wav', 'local-assets.wav'].map(name => path.join(profilePath, name))
  for (const filename of files) await fs.writeFile(filename, makeWav())
  const picPath = path.join(profilePath, 'local-assets.png')
  await fs.writeFile(picPath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  await fs.writeFile(path.join(profilePath, 'local-assets.lrc'), '[00:00.00]本地附带的歌词\n[00:20.00]保留本地信息')
  const before = await Promise.all(files.map(hash))
  const { app, page, errors } = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
  try {
    page.setDefaultTimeout(12000)
    const songs = await page.evaluate(async files => {
      const result = await window.lx.worker.main.createLocalMusicInfos(files)
      if (result.failedPaths.length) throw Error('Failed to import audio')
      const songs = result.musicInfos.map((song, index) => ({ ...song, id: `metadata-${index}`, meta: { ...song.meta, picUrl: 'https://example.com/wrong-local-cover.png' } }))
      const ipc = require('electron').ipcRenderer
      for (const song of songs) {
        await ipc.invoke('winMain_save_lyric_raw', { id: song.id, lyrics: { lyric: '[00:00.00]错误的在线歌词' } })
      }
      await ipc.invoke('player_list_data_overwire', {
        defaultList: [], loveList: [], tempList: [],
        userList: [{ id: 'metadata-playlist', name: '本地元数据测试', locationUpdateTime: null, list: songs }],
      })
      window.__lxPluginHost.player.getAudioElement().muted = true
      return songs
    }, files)
    assert.deepEqual(songs.map(song => [song.name, song.singer, song.meta.albumName]), [['recording', '', ''], ['local-assets', '', '']])
    assert.deepEqual(await page.evaluate(files => Promise.all(files.map(file => window.lx.worker.main.hasMusicFileTags(file))), files), [false, false])
    await route(page, '/list?id=metadata-playlist')
    await settled(page)

    await t.test('the song list and playback skip old online artwork and lyric caches', async() => {
      await page.waitForFunction(() => document.querySelector('[data-song-id="metadata-1"] img')?.complete)
      assert.equal(await page.locator('[data-song-id="metadata-0"] img').count(), 0)
      await page.locator('[data-song-id="metadata-0"] [data-music-cell="index"]').dblclick()
      await page.waitForFunction(() => {
        const info = window.lxData.musicInfo
        return info.id === 'metadata-0' && info.lrc === '' && info.pic === '' && !window.__lxPluginHost.player.getAudioElement().paused
      })
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getDuration()), 60)
    })

    await t.test('sidecar artwork and lyrics still load during playback', async() => {
      await page.locator('[data-song-id="metadata-1"] [data-music-cell="index"]').dblclick()
      await page.waitForFunction(picPath => {
        const info = window.lxData.musicInfo
        return info.id === 'metadata-1' && info.pic === picPath && info.lrc?.includes('本地附带的歌词')
      }, picPath)
      assert.equal(await page.evaluate(() => window.lxData.musicInfo.lrc.includes('错误的在线歌词')), false)
    })

    await t.test('explicitly edited lyrics remain available for an untagged song', async() => {
      await page.evaluate(() => require('electron').ipcRenderer.invoke('winMain_save_lyric_edited', {
        id: 'metadata-0', lyrics: { lyric: '[00:00.00]手动保存的歌词' },
      }))
      await page.locator('[data-song-id="metadata-0"] [data-music-cell="index"]').dblclick()
      await page.waitForFunction(() => window.lxData.musicInfo.id === 'metadata-0' && window.lxData.musicInfo.lrc?.includes('手动保存的歌词'))
      assert.equal(await page.evaluate(() => window.lxData.musicInfo.pic), '')
    })

    assert.deepEqual(await Promise.all(files.map(hash)), before, 'playback must not modify audio files')
    const history = await page.evaluate(() => require('electron').ipcRenderer.invoke('winMain_library_action', { method: 'getListeningHistory', args: [] }))
    assert.deepEqual(history.rows.map(row => row.song.id), ['metadata-0', 'metadata-1', 'metadata-0'])
    assert.deepEqual(errors, [])
  } finally {
    await app.close()
  }
})
