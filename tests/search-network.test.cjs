const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadSearchSdk = require('./helpers/load-search-sdk.cjs')
const loadTypeScript = require('./helpers/load-typescript.cjs')
const flush = () => new Promise(resolve => setImmediate(resolve))

test('aggregate request failures show a generic message without exposing codes or reasons', async() => {
  const previousWindow = globalThis.window
  globalThis.window = { i18n: { t: key => key } }
  try {
    const { createAggregateSearch } = loadTypeScript({
      '@renderer/utils/requestContext': { withRequestDeadline: (_timeout, request) => request() },
    })('src/renderer/store/search/aggregate.ts')
    const aggregate = createAggregateSearch()
    const list = { key: 'query', list: [], noItemLabel: '' }
    await aggregate.search(list, ['kw', 'tx'], () => Promise.reject(new Error('HTTP 403: SECRET_REASON')), () => {})
    assert.equal(list.aggregate.status, 'failed')
    assert.deepEqual(list.aggregate.failedSources, ['kw', 'tx'])
    assert.equal(list.noItemLabel, 'list__load_failed')
    assert.doesNotMatch(JSON.stringify(list), /HTTP 403|SECRET_REASON|errorCode|errorMessage/)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})

test('B14: an old page cannot overwrite a concurrent forced refresh', async() => {
  const waiting = []
  const f = loadSearchSdk(() => new Promise(resolve => waiting.push(resolve)))
  const sdk = f.sdk('kw')
  const response = name => ({ statusCode: 200, body: { TOTAL: 100, abslist: [{ MUSICRID: 'MUSIC_1', SONGNAME: name }] } })
  const firstPage = sdk.search('same', 1, 30)
  await flush(); waiting.shift()(response('first')); await firstPage
  const old = sdk.search('same', 2, 30)
  await flush()
  const fresh = sdk.search('same', 2, 30, { refresh: true })
  await flush()
  waiting[1](response('fresh')); await fresh
  waiting[0](response('old')); await old
  assert.equal((await sdk.search('same', 2, 30)).list[0].name, 'fresh')
  assert.equal(f.calls.length, 3)
})

test('B09: concurrent playlist snapshots retain the credentials belonging to each request', async() => {
  const f = loadSearchSdk(call => ({ statusCode: 200, body: { code: 200, playlist: { trackIds: [], tracks: [], creator: { nickname: call.headers.Cookie } }, privileges: [] } }))
  const sdk = f.load('musicSdk/wy/songList.js').default
  const [a, b] = await Promise.all([sdk.getListDetail('1###account-a', 1), sdk.getListDetail('1###account-b', 1)])
  assert.equal(a.info.author, 'MUSIC_U=account-a')
  assert.equal(b.info.author, 'MUSIC_U=account-b')
})

test('B14: short-lived results are reused, copied, expire and can be explicitly refreshed', async() => {
  const f = loadSearchSdk(() => ({ statusCode: 200, body: { TOTAL: 1, abslist: [{ MUSICRID: 'MUSIC_1', SONGNAME: 'song' }] } }))
  const sdk = f.sdk('kw')
  const first = await sdk.search('same', 1, 30)
  first.list[0].name = 'mutated'
  assert.equal((await sdk.search('same', 1, 30)).list[0].name, 'song')
  assert.equal(f.calls.length, 1)
  f.advanceTime(30001)
  await sdk.search('same', 1, 30)
  assert.equal(f.calls.length, 2)
  await sdk.search('same', 1, 30, { refresh: true })
  assert.equal(f.calls.length, 3)
})

test('B11: permission/business errors stop immediately; transient failures retry and retain codes', async() => {
  for (const source of ['kg', 'wy']) {
    const f = loadSearchSdk(() => ({ statusCode: 200, body: source === 'kg' ? { error_code: 403 } : { code: 301 } }))
    await assert.rejects(f.sdk(source).search('song', 1, 30), error => error.source === source && error.kind === 'permission')
    assert.equal(f.calls.length, 1)
  }
  const f = loadSearchSdk((call, count) => count < 3 ? { statusCode: 503, body: {} } : { statusCode: 200, body: { error_code: 0, data: ['ok'] } })
  assert.equal((await f.load('musicSdk/kg/util.js').createHttpFetch('url', {}))[0], 'ok')
  assert.equal(f.calls.length, 3)
  assert.deepEqual(f.waits, [200, 400])
})

test('B09: NetEase playlist pages share the full snapshot, preserve page boundaries and isolate credentials', async() => {
  const tracks = Array.from({ length: 1002 }, (_, id) => ({ id: id + 1, name: String(id), ar: [], al: {}, dt: 1000 }))
  const f = loadSearchSdk(() => ({ statusCode: 200, body: { code: 200, playlist: { tracks, trackIds: tracks.map(({ id }) => ({ id })), creator: { nickname: 'author' } }, privileges: tracks.map(({ id }) => ({ id, maxbr: 128000 })).reverse() } }))
  const sdk = f.load('musicSdk/wy/songList.js').default
  const [first, second] = await Promise.all([sdk.getListDetail('playlist', 1), sdk.getListDetail('playlist', 2)])
  assert.equal(f.calls.length, 1)
  assert.equal(first.list.length, 1000)
  assert.deepEqual(Array.from(second.list, song => song.songmid), [1001, 1002])
  await sdk.getListDetail('playlist###different-account', 2)
  assert.equal(f.calls.length, 2)
  await sdk.getListDetail('playlist', 1, 0, true)
  assert.equal(f.calls.length, 3)
})

test('B10: batched Kugou and Migu details share a four-request ceiling across callers', async() => {
  let active = 0, peak = 0
  const f = loadSearchSdk(async({ url }) => {
    active++; peak = Math.max(peak, active)
    await flush(); active--
    return { statusCode: 200, body: url.includes('kugou') ? { error_code: 0, data: [] } : { code: '000000', resource: [] } }
  })
  const kg = f.load('musicSdk/kg/musicInfo.js'), mg = f.load('musicSdk/mg/musicInfo.js')
  await Promise.all([kg.getMusicInfos(Array.from({ length: 700 }, (_, hash) => ({ hash }))), mg.getMusicInfos(Array.from({ length: 700 }, (_, id) => id))])
  assert.equal(peak, 4)
  assert.equal(f.calls.length, 14)
})

test('B07: Migu cover and lyric details share pending and completed detail lookup', async() => {
  const f = loadSearchSdk(() => ({ statusCode: 200, body: { code: '000000', resource: [{ songId: 'id', songName: 'song', artists: [], albumImgs: [{ img: 'https://cover.test/a' }], lrcUrl: 'lyrics' }] } }))
  const { getMusicInfo } = f.load('musicSdk/mg/musicInfo.js')
  const pic = f.load('musicSdk/mg/pic.js').default
  const [cover, info] = await Promise.all([pic.getPic({ songmid: 'id' }), getMusicInfo('id')])
  assert.equal(cover, 'https://cover.test/a')
  assert.equal(info.lrcUrl, 'lyrics')
  await getMusicInfo('id')
  assert.equal(f.calls.length, 1)
  await getMusicInfo('id', true)
  assert.equal(f.calls.length, 2)
})

test('B08: a malformed Kuwo row does not discard good rows or retry the same response', async() => {
  const f = loadSearchSdk(() => ({ statusCode: 200, body: { TOTAL: 4, abslist: [null, { SONGNAME: 'missing id' }, { MUSICRID: 'MUSIC_1', SONGNAME: 'no optional quality' }, { MUSICRID: 'MUSIC_2', SONGNAME: 'good', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M' }] } }))
  const result = await f.sdk('kw').search('song', 1, 30)
  assert.deepEqual(Array.from(result.list, song => song.songmid), ['1', '2'])
  assert.equal(f.calls.length, 1)
})

test('B06: overlapping Migu pages share physical requests and fetch multiple pages concurrently', async() => {
  const pending = []
  const f = loadSearchSdk(call => new Promise(resolve => pending.push({ call, resolve })))
  const api = f.load('musicSdk/mg/searchFallback.js')
  const context = { filterData: pages => pages.flat() }
  const first = api.pcSearch.call(context, 'song', 1, 30)
  const second = api.pcSearch.call(context, 'song', 2, 30)
  await flush()
  assert.equal(pending.length, 3, 'physical pages start together, up to three at a time')
  const finish = ({ call, resolve }) => {
    const page = Number(new URL(call.url).searchParams.get('pageNo'))
    resolve({ statusCode: 200, body: Array.from({ length: 20 }, (_, i) => ({ songId: String((page - 1) * 20 + i), copyrightId: String((page - 1) * 20 + i + 1), songName: 'song', source: 'mg', songmid: String((page - 1) * 20 + i) })) })
  }
  pending.slice().forEach(finish)
  await flush()
  pending.slice(3).forEach(finish)
  const [a, b] = await Promise.all([first, second])
  assert.equal(f.calls.length, 4, 'the overlapping second physical page is requested once')
  assert.equal(new Set([...a.list, ...b.list].map(song => song.songmid)).size, 60)
  await api.pcSearch.call(context, 'song', 1, 30)
  assert.equal(f.calls.length, 4)
})

test('B03: Kugou retains distinct group children even when the parent was already seen', () => {
  const sdk = loadSearchSdk(() => {}).sdk('kg')
  const song = (Audioid, FileHash) => ({ Audioid, FileHash, OriSongName: String(Audioid), Singers: [] })
  const parent = song(1, 'parent'), child = song(2, 'child'), sibling = song(3, 'other')
  const list = sdk.handleResult([parent, { ...parent, Grp: [child, child, sibling] }, child])
  assert.deepEqual(Array.from(list, item => item.songmid), [1, 2, 3])
})

test('B05: smartbox details use one batch, preserve order and tolerate missing or mismatched items', async() => {
  const f = loadSearchSdk(({ url, body }) => {
    if (url.includes('smartbox')) return { statusCode: 200, body: { code: 0, data: { song: { itemlist: ['a', 'b', 'a', 'c'].map(mid => ({ mid })) } } } }
    assert.deepEqual(Object.keys(body), ['comm', 'req_0', 'req_1', 'req_2'])
    const detail = mid => ({ code: 0, data: { track_info: { mid, title: mid, singer: [], file: { media_mid: mid } } } })
    return { statusCode: 200, body: { code: 0, req_2: detail('c'), req_1: detail('mismatch'), req_0: detail('a') } }
  })
  const result = await f.load('musicSdk/tx/searchFallback.js').smartboxSearch.call({}, 'song', 1, 30)
  assert.deepEqual(Array.from(result.list, song => song.songmid), ['a', 'c'])
  assert.equal(f.calls.length, 2)
})

test('B04: desktop and mobile QQ retries have one bounded six-request allowance', async() => {
  const f = loadSearchSdk(({ url }) => url === 'qq-signed'
    ? { statusCode: 200, body: { code: 0, req: { code: 2001 } } }
    : { statusCode: 200, body: { code: 0, data: { song: { itemlist: [] } } } })
  assert.equal((await f.sdk('tx').search('failure', 1, 30)).list.length, 0)
  assert.equal(f.calls.filter(call => call.url === 'qq-signed').length, 6)
  assert.equal(f.calls.length, 7)
  assert.deepEqual(f.waits, [700, 1500, 700, 1500])
})
