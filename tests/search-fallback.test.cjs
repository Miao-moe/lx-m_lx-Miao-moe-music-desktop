const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-search-sdk.cjs')

const ok = body => ({ statusCode: 200, body })
const fail = () => { throw new Error('upstream unavailable') }
const txSong = (mid = 'qq-mid') => ({
  id: 123, mid, title: 'Talullah', type: 0, interval: 360,
  singer: [{ name: 'Jamiroquai' }], album: { name: 'Dynamite', mid: 'album' },
  file: { media_mid: 'media-' + mid, size_128mp3: 1234 },
})
const txResponse = songs => ok({ code: 0, req: { code: 0, data: { body: { song: { list: songs } }, meta: { sum: songs.length } } } })
const wySong = id => ({ id, name: '晴天', ar: [{ name: '歌手' }], al: { id: 3, name: '专辑', picUrl: 'https://example.test/cover.jpg' }, dt: 1000, privilege: { maxbr: 128000 }, l: { size: 123 } })
const mgSong = (id, legacy) => legacy ? {
  id: String(id), copyrightId: 'copyright-' + id, name: '晴天', singers: [{ name: '歌手' }], albums: [{ id: 'album', name: '专辑' }],
  newRateFormats: [{ formatType: 'HQ', androidSize: 320 }, { formatType: 'ZQ', size: 999 }], imgItems: [{ img: 'https://example.test/cover.jpg' }], lyricUrl: 'lyrics',
} : {
  songId: String(id), copyrightId: 'copyright-' + id, songName: '晴天', singerList: [{ name: '歌手' }], album: '专辑', albumId: 'album',
  audioFormats: [{ formatType: 'PQ', asize: 128 }], img2: 'https://example.test/cover.jpg', mrcUrl: 'word-lyrics',
}

const emptyPrimary = {
  kw: { TOTAL: '0', SHOW: '0', abslist: [] },
  kg: { error_code: 0, data: { lists: [], total: 0 } },
  tx: txResponse([]).body,
  wy: { code: 200, data: { resources: [], totalCount: 0 } },
  mg: { code: '000000', songResultData: { resultList: [], totalCount: 0 } },
}

test('all five platforms accept a valid empty official result without contacting fallbacks', async() => {
  for (const source of Object.keys(emptyPrimary)) {
    const f = load(() => ok(emptyPrimary[source]))
    const result = await f.sdk(source).search('no results', 1, 10)
    assert.equal(result.total, 0, source)
    assert.equal(result.limit, 10, source)
    assert.equal(f.calls.length, 1, source)
  }
})

test('valid songs from each official primary are returned without a backup request', async() => {
  const primary = {
    kw: { TOTAL: '1', abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: '晴天', ARTIST: '歌手', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M' }] },
    kg: { error_code: 0, data: { total: 1, lists: [{ Audioid: 42, FileHash: 'HASH', FileSize: 128, SongName: '晴天', Singers: [{ name: '歌手' }], Duration: 12 }] } },
    tx: txResponse([txSong()]).body,
    wy: { code: 200, data: { resources: [{ baseInfo: { simpleSongData: wySong(42) } }], totalCount: 1 } },
    mg: { code: '000000', songResultData: { resultList: [[{ ...mgSong(42, false), name: '晴天' }]], totalCount: '1' } },
  }
  for (const source of Object.keys(primary)) {
    const f = load(() => ok(primary[source]))
    const result = await f.sdk(source).search('song', 1, 10)
    assert.equal(result.list.length, 1, source)
    assert.equal(result.total, 1, source)
    assert.equal(f.calls.length, 1, source)
  }
})

test('Kuwo falls back from malformed primary data and preserves RID, quality and real pagination', async() => {
  const f = load(({ url }) => url.includes('search.kuwo.cn') ? ok({ TOTAL: 50 }) : ok({ HIT: '23', abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: '晴天', ARTIST: '歌手', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M', DURATION: '12', ALBUMID: '7' }] }))
  const sdk = f.sdk('kw')
  const first = await sdk.search('晴天 & a', 1, 10)
  assert.equal(first.list[0].songmid, '42')
  assert.equal(first.list[0]._types['128k'].size, '4M')
  assert.equal(first.allPage, 3)
  await sdk.search('晴天 & a', 2, 10)
  assert.equal(f.calls.length, 3, 'later pages stay on the selected fallback')
  const url = new URL(f.calls[2].url)
  assert.equal(url.searchParams.get('all'), '晴天 & a')
  assert.equal(url.searchParams.get('pn'), '1')
})

test('Kugou tries msearch then mobilecdn and normalizes wrapped JSON without mixing audio and album IDs', async() => {
  const f = load(({ url }) => {
    if (!url.startsWith('http://mobilecdn.kugou.com')) return fail()
    return ok('<!--KG_TAG_RES_START-->' + JSON.stringify({ status: 1, errcode: 0, data: { total: 2, info: [{
      audio_id: 42, album_audio_id: 999, hash: 'HASH', filesize: 128, '320hash': 'HQHASH', '320filesize': 320,
      songname: '<em>晴天</em>', singername: '<em>歌手</em>', album_name: '专辑', album_id: '7', duration: 12,
    }] } }) + '<!--KG_TAG_RES_END-->')
  })
  const result = await f.sdk('kg').search('晴天', 1, 10)
  assert.equal(f.calls.length, 3)
  assert(f.calls[1].url.startsWith('https://msearch.kugou.com'))
  assert.equal(result.list[0].songmid, 42)
  assert.equal(result.list[0].hash, 'HASH')
  assert.equal(result.list[0].name, '晴天')
  assert.equal(result.list[0]._types['320k'].hash, 'HQHASH')
  assert.equal(result.list[0].types.length, 2)
})

test('QQ uses the official signed desktop request first and keeps its route when paging', async() => {
  const f = load(({ data }) => {
    if (data.req) return ok({ code: 0, req: { code: 2001 } })
    const req = data['music.search.SearchCgiService']
    assert.match(req.param.searchid, /^[A-F0-9]{32}[0-9]{5}$/)
    assert.equal(req.param.query, 'Talullah Jamiroquai')
    return ok({ code: 0, 'music.search.SearchCgiService': { code: 0, data: { body: { song: { list: [txSong()] } }, meta: { sum: 70 } } } })
  })
  const sdk = f.sdk('tx')
  const result = await sdk.search('Talullah Jamiroquai', 1, 30)
  assert.equal(f.calls.length, 1)
  assert.equal(result.list[0].songmid, 'qq-mid')
  assert.equal(result.list[0].strMediaMid, 'media-qq-mid')
  assert.equal(result.list[0].types.length, 1)
  assert.equal(result.total, 70)
  await sdk.search('Talullah Jamiroquai', 2, 30)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1].data['music.search.SearchCgiService'].param.page_num, 2)
})

test('QQ Smartbox fills exact song details, drops mismatches, and is restricted to one page', async() => {
  const f = load(({ url, body }) => {
    if (url === 'qq-signed') return fail()
    if (url.includes('smartbox')) return ok({ code: 0, data: { song: { itemlist: [{ mid: 'right' }, { mid: 'wrong' }, { mid: 'right' }] } } })
    return ok({ code: 0, ...Object.fromEntries(Object.entries(body).filter(([key]) => key.startsWith('req_')).map(([key, request]) => [key, { code: 0, data: { track_info: txSong(request.param.song_mid === 'right' ? 'right' : 'different') } }])) })
  })
  const sdk = f.sdk('tx')
  const result = await sdk.search('Talullah', 1, 30)
  assert.equal(result.list.length, 1)
  assert.equal(result.list[0].songmid, 'right')
  assert.equal(result.limited, true)
  assert.equal(result.allPage, 1)
  const count = f.calls.length
  assert.equal((await sdk.search('Talullah', 2, 30)).list.length, 0)
  assert.equal(f.calls.length, count)
})

test('NetEase cloudsearch uses the original keyword/offset, privileges, and requested limit', async() => {
  const f = load(({ url, data }) => {
    if (url !== '/api/cloudsearch/pc') return fail()
    assert.equal(data.s, '晴天')
    assert.equal(data.offset, 10)
    return ok({ code: 200, result: { songs: [wySong(42)], songCount: 31 } })
  })
  const result = await f.sdk('wy').search('晴天', 2, 10)
  assert.equal(result.list[0].songmid, 42)
  assert.equal(result.list[0].types[0].type, '128k')
  assert.equal(result.allPage, 4)
  assert.equal(result.limit, 10)
})

test('NetEase suggestions fetch details by ID and tolerate missing/out-of-order privileges', async() => {
  const f = load(({ url, form }) => {
    if (url === '/weapi/search/suggest/web') return ok({ code: 200, result: { songs: [{ id: 42 }, { id: 43 }] } })
    if (!url.includes('/v3/song/detail')) return fail()
    assert.equal(form.ids, '[42,43]')
    return ok({ code: 200, songs: [wySong(43), wySong(42)], privileges: [{ id: 42, maxbr: 128000 }] })
  })
  const result = await f.sdk('wy').search('晴天', 1, 30)
  assert.equal(result.list.length, 1)
  assert.equal(result.list[0].songmid, 42)
  assert.equal(result.total, 1)
  assert.equal(result.limited, true)
})

for (const legacy of [true, false]) {
  test(`Migu ${legacy ? 'old app' : 'PC'} maps fixed 20-song pages to 10/30-song UI pages without duplicates`, async() => {
    for (const limit of [10, 30]) {
      const f = load(({ url }) => {
        const expected = legacy ? 'pd.musicapp.migu.cn' : 'app.u.nf.migu.cn'
        if (!url.includes(expected)) return fail()
        const params = new URL(url).searchParams
        assert.equal(params.get('pageSize'), '20')
        const offset = (Number(params.get('pageNo')) - 1) * 20
        const songs = Array.from({ length: Math.max(0, Math.min(20, 65 - offset)) }, (_, i) => mgSong(offset + i + 1, legacy))
        return ok(legacy ? { code: '000000', songResultData: { result: songs, totalCount: '65' } } : songs)
      })
      const sdk = f.sdk('mg')
      const first = await sdk.search('晴天', 1, limit)
      const second = await sdk.search('晴天', 2, limit)
      assert.deepEqual(Array.from(first.list, song => Number(song.songmid)), Array.from({ length: limit }, (_, i) => i + 1))
      assert.deepEqual(Array.from(second.list, song => Number(song.songmid)), Array.from({ length: limit }, (_, i) => i + 1 + limit))
      assert.equal(first.list[0].copyrightId, 'copyright-1')
      assert.equal(first.list[0].img, 'https://example.test/cover.jpg')
      assert.equal(first.totalIsExact, legacy)
      assert(first.allPage >= 2)
      if (legacy) assert.equal(first.list[0]._types.flac24bit.size, '999')
      else assert.equal(first.list[0].mrcUrl, 'word-lyrics')
      const last = await sdk.search('晴天', Math.ceil(65 / limit), limit)
      assert.equal(last.total, 65)
      assert.equal(last.list.length, 5)
      assert.equal(last.totalIsExact, true)
    }
  })
}

test('all platforms stop cancellation and rate limiting, and failures have a finite route budget', async() => {
  for (const source of Object.keys(emptyPrimary)) {
    for (const mode of ['cancel', 'rate-limit', 'failure']) {
      const f = load(() => {
        if (mode === 'rate-limit') return { statusCode: 429, headers: { 'retry-after': '60' } }
        if (mode === 'cancel') throw new Error('取消http请求')
        return fail()
      })
      await assert.rejects(f.sdk(source).search('private keyword', 1, 30))
      assert(f.calls.length <= (mode === 'failure' ? (source === 'mg' ? 5 : 3) : 1), source + ': ' + mode)
      assert(!f.logs.join('').includes('private keyword'))
    }
  }
})

test('repeated requests share the complete fallback chain and a new search starts with the primary', async() => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let primaryWorks = false
  const f = load(async({ url }) => {
    if (url.includes('search.kuwo.cn')) {
      if (primaryWorks) return ok(emptyPrimary.kw)
      await gate
      return fail()
    }
    return ok({ HIT: 0, abslist: [] })
  })
  const sdk = f.sdk('kw')
  const first = sdk.search('same', 1, 10)
  const second = sdk.search('same', 1, 10)
  release()
  await Promise.all([first, second])
  assert.equal(f.calls.length, 2)
  primaryWorks = true
  await sdk.search('same', 1, 10, { refresh: true })
  assert.equal(f.calls.length, 3)
  assert(f.calls[2].url.includes('search.kuwo.cn'))
})

test('a pinned provider failure on page two does not substitute another provider ranking', async() => {
  const f = load(({ url }) => {
    if (new URL(url).searchParams.get('pn') === '1') return fail()
    return ok({ TOTAL: 20, abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: 'song', ARTIST: 'artist', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M' }] })
  })
  const sdk = f.sdk('kw')
  await sdk.search('same', 1, 10)
  await assert.rejects(sdk.search('same', 2, 10))
  assert.equal(f.calls.length, 2)
})

test('page two requested while page one is loading waits for the selected backup', async() => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = load(async({ url }) => {
    if (url.includes('search.kuwo.cn')) { await gate; return fail() }
    return ok({ HIT: 20, abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: 'song', ARTIST: 'artist', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M' }] })
  })
  const sdk = f.sdk('kw')
  const first = sdk.search('same', 1, 10)
  const second = sdk.search('same', 2, 10)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.calls.length, 1)
  release()
  await Promise.all([first, second])
  assert.equal(f.calls.length, 3)
  assert(f.calls.slice(1).every(call => call.url.startsWith('https://www.kuwo.cn')))
})

test('Migu cover lookup returns a URL and retries with the same song ID when search supplied no cover', async() => {
  const f = load(({ url, form }, count) => {
    assert.equal(new URL(url).pathname, '/MIGUM2.0/v1.0/content/resourceinfo.do')
    assert.equal(form.resourceId, '42')
    return count === 1 ? { statusCode: 503, body: {} } : ok({ returnCode: '000000', resource: [{ songId: '42', albumImgs: [{ img: '//example.test/cover.jpg' }] }] })
  })
  const pic = f.load('musicSdk/mg/pic.js').default
  assert.equal(await pic.getPic({ songmid: '42', copyrightId: 'copyright-42' }), 'https://example.test/cover.jpg')
  assert.equal(f.calls.length, 2)
})

test('Migu missing covers reject through the awaited promise with bounded requests', async() => {
  for (const body of [{ returnCode: '000000', resource: [] }, { returnCode: '000000', resource: [{ songId: '42' }] }, { returnCode: '000000', resource: [{ songId: '42', albumImgs: [{ img: 'invalid' }] }] }]) {
    const f = load(() => ok(body))
    await assert.rejects(f.load('musicSdk/mg/pic.js').default.getPic({ songmid: '42' }))
    assert.equal(f.calls.length, 1)
  }
})
