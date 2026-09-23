const assert = require('node:assert/strict')
const { test } = require('node:test')
const loadSearchSdk = require('./helpers/load-search-sdk.cjs')

test('B23: Kuwo digest-5 requests the requested song page with a numeric pn', async() => {
  const fixture = loadSearchSdk(({ url }) => {
    if (url.includes('qukudata.kuwo.cn')) return { statusCode: 200, body: { child: [{ sourceid: 'child-42' }] } }
    const params = new URL(url).searchParams
    assert.equal(params.get('pid'), 'child-42')
    assert.equal(params.get('pn'), '1')
    return { statusCode: 200, body: { result: 'ok', musiclist: [], rn: 1000, total: 0, title: 'Kuwo list' } }
  })
  const detail = await fixture.load('musicSdk/kw/songList.js').default.getListDetail('digest-5__parent-10', 2)
  assert.equal(detail.page, 2)
  assert.equal(detail.info.name, 'Kuwo list')
  assert.equal(detail.list.length, 0)
  assert.equal(fixture.calls.length, 2)
})

test('B24: Kuwo digest-5 retries its info and music requests without changing the page or child ID', async() => {
  let infoAttempts = 0
  let musicAttempts = 0
  const fixture = loadSearchSdk(({ url }) => {
    const params = new URL(url).searchParams
    if (url.includes('qukudata.kuwo.cn')) {
      infoAttempts++
      assert.equal(params.get('node'), 'parent-10')
      return infoAttempts === 1
        ? { statusCode: 503, body: {} }
        : { statusCode: 200, body: { child: [{ sourceid: 'child-42' }] } }
    }
    musicAttempts++
    assert.equal(params.get('pid'), 'child-42')
    assert.equal(params.get('pn'), '1')
    return musicAttempts === 1
      ? { statusCode: 200, body: { result: 'error' } }
      : { statusCode: 200, body: { result: 'ok', musiclist: [], rn: 1000, total: 0, title: 'Retry succeeded' } }
  })
  const detail = await fixture.load('musicSdk/kw/songList.js').default.getListDetail('digest-5__parent-10', 2)
  assert.equal(detail.info.name, 'Retry succeeded')
  assert.equal(detail.page, 2)
  assert.equal(infoAttempts, 2)
  assert.equal(musicAttempts, 2)
})

test('B24: Kuwo digest-5 info retries stop after three failed responses', async() => {
  const fixture = loadSearchSdk(() => ({ statusCode: 503, body: {} }))
  await assert.rejects(
    fixture.load('musicSdk/kw/songList.js').default.getListDetail('digest-5__parent-10', 2),
    /try max num/,
  )
  assert.equal(fixture.calls.length, 3)
  assert(fixture.calls.every(({ url }) => url.includes('qukudata.kuwo.cn')))
})

test('B25: Migu retries only playlist info and keeps its info return type and song page', async() => {
  let infoAttempts = 0
  const successInfo = {
    code: '000000',
    data: {
      title: 'Migu list', imgItem: { img: 'cover' }, summary: 'description', ownerName: 'author', opNumItem: { playNum: 5 },
    },
  }
  const fixture = loadSearchSdk(({ url }) => {
    const params = new URL(url).searchParams
    assert.equal(params.get('playlistId'), '123')
    if (url.includes('/playlist/song/v2.0')) {
      assert.equal(params.get('pageNo'), '4')
      return { statusCode: 200, body: { code: '000000', data: { songList: [], totalCount: 0 } } }
    }
    infoAttempts++
    return infoAttempts < 3
      ? { statusCode: 200, body: { code: 'BUSINESS_ERROR' } }
      : { statusCode: 200, body: successInfo }
  })
  const detail = await fixture.load('musicSdk/mg/songList.js').default.getListDetail('123', 4)
  assert.equal(detail.info.name, 'Migu list')
  assert.equal(detail.page, 4)
  assert.equal(infoAttempts, 3)
  assert.equal(fixture.calls.filter(({ url }) => url.includes('/playlist/song/v2.0')).length, 1)
})

test('B25: Migu playlist info retries stop without requesting another song page', async() => {
  const fixture = loadSearchSdk(({ url }) => url.includes('/playlist/song/v2.0')
    ? { statusCode: 200, body: { code: '000000', data: { songList: [], totalCount: 0 } } }
    : { statusCode: 200, body: { code: 'BUSINESS_ERROR' } })
  await assert.rejects(fixture.load('musicSdk/mg/songList.js').default.getListDetail('123', 4), /try max num/)
  assert.equal(fixture.calls.filter(({ url }) => url.includes('/playlist/song/v2.0')).length, 1)
  assert.equal(fixture.calls.filter(({ url }) => url.includes('/playlist/v2.0')).length, 3)
})
