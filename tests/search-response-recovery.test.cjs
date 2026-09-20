const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const util = loader({
  '@common/ipcNames': {}, '@common/rendererIpc': {}, crypto: require('node:crypto'), '../utils': {},
})('src/renderer/utils/musicSdk/kw/util.js')

const fixture = (kind, response) => {
  const sdk = loader({
    '../../request': { httpFetch: () => ({ promise: Promise.resolve(response) }) },
    '../../index': { decodeName: value => value, formatPlayTime: String },
    './util': util,
    './album': {},
  })(`src/renderer/utils/musicSdk/kw/${kind === 'songlist' ? 'songList' : 'entitySearch'}.js`).default
  return () => kind === 'songlist' ? sdk.search('query', 1) : sdk.search(kind, 'query', 1)
}

for (const kind of ['songlist', 'singer', 'album']) {
  test(`${kind}: HTTP errors and malformed Kuwo responses are failures, not empty results`, async() => {
    for (const response of [
      { statusCode: 403, body: { TOTAL: '0', total: 0, abslist: [], albumlist: [] } },
      { statusCode: 200, body: {} },
      { statusCode: 200, body: { message: 'upstream unavailable' } },
      { statusCode: 200, body: { TOTAL: '1', abslist: null, albumlist: null } },
    ]) await assert.rejects(fixture(kind, response))
  })

  test(`${kind}: valid empty responses remain empty without a false failure`, async() => {
    const result = await fixture(kind, { statusCode: 200, body: { TOTAL: '0', total: 0, abslist: [], albumlist: [] } })()
    assert.equal(result.list.length, 0)
    assert.equal(result.total, 0)
    if (kind !== 'songlist') {
      const omittedList = await fixture(kind, { statusCode: 200, body: { TOTAL: '0' } })()
      assert.equal(omittedList.list.length, 0)
    }
  })
}

test('Kuwo playlists support both parsed JSON and the legacy single-quoted response', async() => {
  const data = { TOTAL: '1', abslist: [{ playlistid: 42, name: 'Playlist', nickname: 'Artist', songnum: 1, intro: '', pic: '', playcnt: 0 }] }
  for (const body of [data, JSON.stringify(data).replace(/"/g, "'")]) {
    const result = await fixture('songlist', { statusCode: 200, body })()
    assert.equal(result.list[0].name, 'Playlist')
    assert.equal(result.list[0].id, '42')
    assert.equal(result.total, 1)
  }
})
