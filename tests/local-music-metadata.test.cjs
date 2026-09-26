const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const onlinePic = 'https://example.com/incorrect-cover.jpg'
const onlineLyric = { lyric: '[00:00.00]An online match' }
const fileLyric = { lyric: '[00:00.00]Local lyrics' }
const localSong = () => ({
  id: 'recording.wav', source: 'local', name: 'recording', singer: '', interval: '00:10',
  meta: { filePath: 'recording.wav', ext: 'wav', albumName: '', picUrl: onlinePic },
})

function fixture(t, { hasTags = false, pic = '', lyric = null, edited = { lyric: '' }, fallback = false } = {}) {
  const previous = global.window
  t.after(() => { global.window = previous })
  const calls = { online: [], saves: [], updates: [], cachedLyrics: 0 }
  global.window = { i18n: { t: key => key === 'webdav_audio_removed' ? 'WebDAV audio browsing has been removed' : key }, lx: { worker: { main: {
    hasMusicFileTags: async() => hasTags,
    getMusicFilePic: async() => pic,
    getMusicFileLyric: async() => lyric,
  } } } }
  const source = { id: 'online-song', source: 'wy' }
  const track = (name, result) => async() => {
    calls.online.push(name)
    if (fallback && name.endsWith('ByLocal')) throw Error('Unsupported source')
    return result
  }
  const local = loader({
    '@common/utils/common': { encodePath: value => value },
    '@renderer/store/list/action': { updateListMusics: async items => { calls.updates.push(...items) } },
    '@renderer/utils/ipc': {
      getLyricEdited: async() => edited,
      saveLyric: async(musicInfo, lyricInfo) => { calls.saves.push({ musicInfo, lyricInfo }) },
      saveMusicUrl: async() => { calls.saves.push('music-url') },
    },
    '@renderer/utils/music': { getLocalFilePath: async info => info.meta.filePath },
    './utils': {
      buildLyricInfo: async info => ({ ...info, rawlrcInfo: info.rawlrcInfo ?? { ...info } }),
      getCachedLyricInfo: async() => { calls.cachedLyrics++; return onlineLyric },
      getOtherSource: track('search', [source]),
      getOnlineOtherSourcePicByLocal: track('picByLocal', { url: onlinePic }),
      getOnlineOtherSourceLyricByLocal: track('lyricByLocal', { lyricInfo: onlineLyric, isFromCache: false }),
      getOnlineOtherSourcePicUrl: track('picFallback', { url: onlinePic, musicInfo: source, isFromCache: false }),
      getOnlineOtherSourceLyricInfo: track('lyricFallback', { lyricInfo: onlineLyric, musicInfo: source, isFromCache: false }),
    },
  })('src/renderer/core/music/local.ts')
  return { local, calls }
}

test('legacy WebDAV songs fail clearly without probing disk or matching online metadata', async t => {
  const { local, calls } = fixture(t, { hasTags: true, pic: onlinePic, lyric: onlineLyric })
  const musicInfo = localSong()
  musicInfo.meta.webdav = { path: 'folder/song.wav', identity: 'account' }
  await assert.rejects(local.getMusicUrl({ musicInfo, isRefresh: false }), { code: 'WEBDAV_AUDIO_REMOVED', message: 'WebDAV audio browsing has been removed' })
  assert.equal(await local.getPicUrl({ musicInfo, isRefresh: false }), '')
  assert.equal((await local.getLyricInfo({ musicInfo, isRefresh: false })).lyric, '')
  assert.deepEqual(calls, { online: [], saves: [], updates: [], cachedLyrics: 0 })
})

for (const isRefresh of [false, true]) {
  test(`untagged local songs ignore online matches and old caches (refresh=${isRefresh})`, async t => {
    const { local, calls } = fixture(t)
    const musicInfo = localSong()
    const before = structuredClone(musicInfo)
    assert.equal(await local.getPicUrl({ musicInfo, listId: 'local-list', isRefresh }), '')
    assert.deepEqual(await local.getLyricInfo({ musicInfo, isRefresh }), { lyric: '', rawlrcInfo: { lyric: '' } })
    assert.deepEqual(calls, { online: [], saves: [], updates: [], cachedLyrics: 0 })
    assert.deepEqual(musicInfo, before)
  })

  test(`untagged local songs retain their own cover and lyrics (refresh=${isRefresh})`, async t => {
    const { local, calls } = fixture(t, { pic: 'recording.jpg', lyric: fileLyric })
    assert.equal(await local.getPicUrl({ musicInfo: localSong(), isRefresh }), 'recording.jpg')
    const result = await local.getLyricInfo({ musicInfo: localSong(), isRefresh })
    assert.deepEqual(result, { ...fileLyric, rawlrcInfo: fileLyric })
    assert.deepEqual(calls, { online: [], saves: [], updates: [], cachedLyrics: 0 })
  })
}

test('untagged songs retain manually edited lyrics with the local original', async t => {
  const edited = { lyric: '[offset:100]\n[00:00.00]Local lyrics' }
  const { local, calls } = fixture(t, { edited, lyric: fileLyric })
  assert.deepEqual(await local.getLyricInfo({ musicInfo: localSong(), isRefresh: false }), { ...edited, rawlrcInfo: fileLyric })
  assert.equal(calls.cachedLyrics, 0)
  assert.deepEqual(calls.online, [])
})

for (const fallback of [false, true]) {
  test(`tagged songs still support online artwork and lyrics (fallback=${fallback})`, async t => {
    const { local, calls } = fixture(t, { hasTags: true, fallback })
    const musicInfo = localSong()
    musicInfo.meta.picUrl = ''
    assert.equal(await local.getPicUrl({ musicInfo, listId: 'local-list', isRefresh: true }), onlinePic)
    assert.equal((await local.getLyricInfo({ musicInfo, isRefresh: true })).lyric, onlineLyric.lyric)
    assert(calls.saves.some(item => item.musicInfo === musicInfo && item.lyricInfo === onlineLyric))
    assert.equal(calls.updates.length, fallback ? 1 : 0)
  })
}

test('untagged audio playback continues to use the existing local file', async t => {
  const { local, calls } = fixture(t)
  assert.equal(await local.getMusicUrl({ musicInfo: localSong(), isRefresh: false }), 'recording.wav')
  assert.deepEqual(calls.online, [])
})

test('online matching requires actual identifying tags and notices file edits', async() => {
  let version = 0
  let common = {}
  const music = loader({
    '@common/utils/nodejs': {
      extname: path.extname,
      getFileStats: async() => ({ isFile: () => true, size: 10, mtimeMs: version, ctimeMs: version }),
    },
    '@common/utils/common': {},
    '@common/utils/lyricUtils/kg': {},
    'music-metadata': { parseFile: async() => ({ common }) },
  })('src/renderer/utils/music.ts')
  for (const [tags, expected] of [
    [{}, false],
    [{ title: ' ', artist: '\t', artists: [' '], album: ' ' }, false],
    [{ picture: [{}], genre: ['Pop'], comment: ['a recording'], lyrics: ['lyrics'] }, false],
    [{ title: 'Song' }, true],
    [{ artist: 'Artist' }, true],
    [{ artists: ['', ' Artist '] }, true],
    [{ album: 'Album' }, true],
    [{}, false],
  ]) {
    version++
    common = tags
    assert.equal(await music.hasLocalMusicFileTags('Artist - Song.mp3'), expected, JSON.stringify(tags))
  }
})
