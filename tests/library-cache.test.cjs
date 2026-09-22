const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const loader = require('./helpers/load-typescript.cjs')
const load = loader({ 'image-size': require('image-size') })
const { BoundedMap } = load('src/common/utils/boundedMap.ts')
const { findDuplicateSongs } = load('src/common/musicIdentity.ts')
const { validateArtwork, readArtworkResponse, MAX_ARTWORK_BYTES } = load('src/common/utils/imageLimits.ts')
const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')

test('E03: LRU honors size, mutation and active list pins without invalidating iteration', () => {
  const cache = new BoundedMap(2, 4, items => items.length, key => key === 'active')
  cache.set('active', [1]); cache.set('b', [2]); cache.get('active'); cache.set('c', [3])
  assert(!cache.has('b')); assert(cache.has('active'))
  for (const [key] of cache) cache.get(key)
  cache.get('c').push(4, 5, 6); cache.prune()
  assert(!cache.has('c')); assert.equal(cache.size, 1)
  cache.clear(); assert.equal(cache.size, 0)
})
test('E11: duplicate songs preserve artist, version, album and duration distinctions', () => {
  const song = (id, extra = {}) => ({ id, name: 'Song', singer: 'Artist', interval: '03:00', meta: { albumName: 'Album' }, ...extra })
  const result = findDuplicateSongs([song('one'), song('two', { interval: '03:01' }), song('artist', { singer: 'Another' }), song('live', { name: 'Song (Live)' }), song('album', { meta: { albumName: 'Other' } }), song('long', { interval: '04:00' }), song('unknown', { singer: '' })])
  assert.deepEqual(result.map(item => item.id), ['one', 'two'])
})
test('E09: artwork pixel and actual streaming limits are enforced before decode', async() => {
  assert.equal(validateArtwork(png()).decodedBytes, 4)
  const oversized = png(); oversized.writeUInt32BE(9000, 16)
  assert.throws(() => validateArtwork(oversized), { code: 'COVER_PIXEL_LIMIT' })
  let cancelled = false
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(MAX_ARTWORK_BYTES + 1)) }, cancel() { cancelled = true } }))
  await assert.rejects(readArtworkResponse(response), { code: 'COVER_SIZE_LIMIT' }); assert(cancelled)
  const actual = await readArtworkResponse(new Response(png()))
  assert.equal(actual.size, png().length)
})

test('E07: alternating metadata requests share work and refresh after edits', async() => {
  let parses = 0, version = 0
  const music = loader({
    '@common/utils/nodejs': { getFileStats: async() => ({ isFile: () => true, size: 10, mtimeMs: version, ctimeMs: version }) },
    '@common/utils/common': {}, '@common/utils/lyricUtils/kg': {},
    'music-metadata': { parseFile: async() => { parses++; return { common: { title: 'Song' } } } },
  })('src/renderer/utils/music.ts')
  await Promise.all([music.hasLocalMusicFileTags('A.mp3'), music.hasLocalMusicFileTags('A.mp3')])
  await music.hasLocalMusicFileTags('B.mp3'); await music.hasLocalMusicFileTags('A.mp3')
  assert.equal(parses, 2)
  version++; await music.hasLocalMusicFileTags('A.mp3'); assert.equal(parses, 3)
  music.clearLocalMetadataCache(); await music.hasLocalMusicFileTags('A.mp3'); assert.equal(parses, 4)
})

test('E08: temporary covers reuse content, prune expired files and spare unrelated files', async() => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-library-artwork-'))
  try {
    const api = loader({ 'image-size': require('image-size'), 'node:os': { tmpdir: () => root } })('src/common/utils/temporaryArtwork.ts')
    await fs.mkdir(api.temporaryArtworkDirectory, { recursive: true })
    const old = path.join(api.temporaryArtworkDirectory, 'a'.repeat(64) + '.png')
    const unrelated = path.join(api.temporaryArtworkDirectory, 'user-notes.txt')
    await fs.writeFile(old, png()); await fs.utimes(old, 1, 1); await fs.writeFile(unrelated, 'keep')
    const results = await Promise.all([api.saveTemporaryArtwork(png(), 'image/png'), api.saveTemporaryArtwork(png(), 'image/png')])
    assert.equal(results[0], results[1])
    const before = await fs.stat(results[0]); await api.saveTemporaryArtwork(png(), 'image/png')
    assert.equal((await fs.stat(results[0])).birthtimeMs, before.birthtimeMs)
    await assert.rejects(fs.access(old), { code: 'ENOENT' })
    assert.equal(await api.getTemporaryArtworkSize(), png().length)
    await api.clearTemporaryArtwork(); assert.equal(await api.getTemporaryArtworkSize(), 0)
    assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep')
  } finally { assert(path.resolve(root).startsWith(path.join(os.tmpdir(), 'lx-library-artwork-'))); await fs.rm(root, { recursive: true, force: true }) }
})

test('E04/E05: large history filtering is linear and repeated search reuses scoring', async() => {
  let scores = 0
  const api = loader({ '@common/utils/nodejs': {}, '@renderer/utils/music': {}, '@common/utils/searchScore': { searchScore: () => { scores++; return 1 } } })('src/renderer/worker/main/list.ts')
  const songs = Array.from({ length: 10000 }, (_, i) => ({ id: String(i), name: 'Alpha Beta ' + i, singer: 'Artist', source: 'local', meta: { albumName: '' } }))
  const history = songs.slice(0, 9000).map(musicInfo => ({ listId: 'list', musicInfo, isTempPlay: false }))
  const result = await api.filterMusicList({ list: songs, playedList: history, listId: 'list', isNext: true, dislikeInfo: { musicNames: new Set(), singerNames: new Set(), names: new Set() } })
  assert.equal(result.filteredList.length, 1000)
  const first = api.searchListMusic(songs, 'AB')
  const count = scores; assert.equal(count, 10000)
  const second = api.searchListMusic(structuredClone(songs), 'AB')
  assert.equal(scores, count); assert.deepEqual(first, second)
  songs[0].name = 'Changed'; api.searchListMusic(songs, 'AB'); assert(scores > count)
})

test('E10: clearing a request cache before its work starts prevents stale repopulation', async() => {
  const request = loader()('src/renderer/utils/musicSdk/requestCache.js').createRequestCache()
  let finish
  const old = request('song', async() => new Promise(resolve => { finish = resolve }))
  request.clear()
  assert.equal(await request('song', async() => 'fresh'), 'fresh')
  finish('old'); assert.equal(await old, 'old')
  assert.equal(await request('song', async() => 'unexpected'), 'fresh')
})
