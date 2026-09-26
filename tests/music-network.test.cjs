const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const flush = () => new Promise(resolve => setImmediate(resolve))
const song = (id = 'kw_1') => ({ id, source: 'kw', name: 'song', singer: 'artist', interval: '03:00', meta: { albumName: 'album', _qualitys: { '128k': {}, '320k': {} } } })
function fixture(respond, findMusic = async() => []) {
  const calls = [], apiSource = { value: 'first' }
  const qualityList = { value: {} }
  global.window = { lx: { apiInitPromise: [Promise.resolve(true)] }, i18n: { t: key => key } }
  const utils = loader({
    '@renderer/store': { apiSource, qualityList },
    '@renderer/store/utils': { assertApiSupport: () => true },
    '@renderer/utils/musicSdk': { findMusic, ...Object.fromEntries(['kw', 'kg', 'tx'].map(source => [source, { getMusicUrl: (song, quality) => { calls.push({ song, quality, source }); return { promise: respond(calls.length, quality, source) } } }])) },
    '@renderer/utils/musicCover': { getMusicCoverUrl: async() => '' },
    '@renderer/utils/ipc': { getMusicUrl: async() => '' },
    '@renderer/store/setting': { appSetting: { 'player.playQuality': '128k' } },
    '@renderer/utils': { toOldMusicInfo: item => item, toNewMusicInfo: item => item },
    '@renderer/utils/message': { requestMsg: { tooManyRequests: 'rate limit' } },
    '@renderer/utils/musicSdk/api-source': {},
  })('src/renderer/core/music/utils.ts')
  const get = (options = {}) => utils.handleGetOnlineMusicUrl({ musicInfo: song(), isRefresh: false, allowToggleSource: false, onToggleSource() {}, ...options })
  return { get, calls, apiSource, qualityList, utils }
}

test('an explicit Master download tries Master for a FLAC-only playlist entry', async() => {
  const f = fixture(async(_count, quality) => ({ url: 'https://audio.test/master', type: quality }))
  f.qualityList.value.kw = ['128k', '320k', 'flac', 'master']
  const info = { ...song(), meta: { albumName: 'album', _qualitys: { flac: {} } } }
  assert.deepEqual(f.utils.getTryQualityList('master', info), ['flac', '320k', '128k'], 'automatic playback keeps its existing quality policy')
  assert.deepEqual(f.utils.getTryQualityList('master', info, true), ['master', 'flac', '320k', '128k'])
  await f.get({ musicInfo: info, quality: 'master' })
  assert.equal(f.calls[0].quality, 'master')
})

test('an exact search match lets a playlist Atmos Plus request reach the source', async() => {
  const f = fixture(async(_count, quality) => ({ url: 'https://audio.test/atmos-plus', type: quality }))
  f.qualityList.value.kw = ['128k', '320k', 'flac', 'flac24bit', 'atmos', 'atmos_plus', 'master']
  const info = { ...song(), meta: { albumName: 'album', _qualitys: { flac: {}, flac24bit: {} } } }
  assert.deepEqual(f.utils.getTryQualityList('atmos_plus', info, true), ['atmos_plus', 'atmos', 'flac24bit', 'flac', '320k', '128k'])
  await f.get({ musicInfo: info, quality: 'atmos_plus' })
  assert.equal(f.calls[0].quality, 'atmos_plus')
})

test('B16: a fast match with an unavailable URL falls through to an untried platform', async() => {
  const searched = []
  const f = fixture(async(count, quality, source) => {
    if (source !== 'tx') throw new Error('unavailable')
    return { url: 'https://audio.test/recovered', type: quality }
  }, async(query, options) => {
    searched.push([...options.excludeSources])
    const source = options.excludeSources.includes('kg') ? 'tx' : 'kg'
    return [{ ...song(source + '_match'), source }]
  })
  const result = await f.get({ allowToggleSource: true, isRefresh: true })
  assert.equal(result.url, 'https://audio.test/recovered')
  assert.deepEqual(f.calls.map(call => call.source), ['kw', 'kg', 'tx'])
  assert.deepEqual(searched, [[], ['kw', 'kg']])
})

test('B17: source matches use stable identities, isolate metadata and refresh past pending work', async() => {
  const gates = [], inputs = []
  const f = fixture(() => {}, (query, options) => { inputs.push({ query, options }); const gate = deferred(); gates.push(gate); return gate.promise })
  const first = f.utils.getOtherSource(song())
  const duplicate = f.utils.getOtherSource(song())
  await flush()
  assert.equal(gates.length, 1)
  const refreshed = f.utils.getOtherSource(song(), true)
  await flush()
  assert.equal(gates.length, 2)
  assert.equal(inputs[1].options.refresh, true)
  gates[1].resolve([{ ...song('new'), source: 'kg' }])
  assert.equal((await refreshed)[0].id, 'new')
  gates[0].resolve([{ ...song('old'), source: 'kg' }])
  await Promise.all([first, duplicate])
  assert.equal((await f.utils.getOtherSource(song()))[0].id, 'new', 'a late older lookup must not overwrite refresh')
  const edited = f.utils.getOtherSource({ ...song(), name: 'edited title' })
  await flush()
  assert.equal(gates.length, 3)
  gates[2].resolve([])
  await edited
})
test('B02: concurrent cache misses share one upstream URL request', async() => {
  const gate = deferred(), f = fixture(() => gate.promise)
  const pending = Array.from({ length: 8 }, () => f.get({ musicInfo: song() }))
  await flush()
  assert.equal(f.calls.length, 1)
  gate.resolve({ url: 'https://audio.test/a', type: '128k' })
  assert((await Promise.all(pending)).every(result => result.url === 'https://audio.test/a'))
})
test('B02: refresh, song, quality and active API are isolated; rejection permits retry', async() => {
  const gates = Array.from({ length: 6 }, deferred), f = fixture(count => gates[count - 1].promise)
  const pending = [f.get(), f.get({ isRefresh: true }), f.get({ musicInfo: song('kw_2') }), f.get({ quality: '320k' })]
  await flush()
  f.apiSource.value = 'second'
  pending.push(f.get())
  await flush()
  assert.equal(f.calls.length, 5)
  const settled = Promise.allSettled(pending)
  gates.slice(0, 5).forEach((gate, i) => i === 0 ? gate.reject(new Error('temporary failure')) : gate.resolve({ url: 'url', type: '128k' }))
  assert.equal((await settled)[0].status, 'rejected')
  f.apiSource.value = 'first'
  const retry = f.get()
  await flush()
  assert.equal(f.calls.length, 6)
  gates[5].resolve({ url: 'recovered', type: '128k' })
  assert.equal((await retry).url, 'recovered')
})
