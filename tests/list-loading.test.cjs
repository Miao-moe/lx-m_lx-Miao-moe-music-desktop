const assert = require('node:assert/strict')
const { test } = require('node:test')
global.window = { i18n: { t: key => key } }
const platforms = ['kw', 'kg', 'tx', 'wy', 'mg']
const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(kind, mode = 'immediate') {
  const calls = []
  const info = () => ({ list: [], key: null, page: 1, maxPage: 0, total: 0, limit: 30, noItemLabel: '' })
  const listInfos = Object.fromEntries([...platforms, 'all'].map(source => [source, info()]))
  const entity = kind === 'singer' || kind === 'album'
  const music = Object.fromEntries(platforms.map(source => {
    const search = (...args) => new Promise((resolve, reject) => calls.push({
      source,
      text: args[entity ? 1 : 0],
      reject,
      finish: (ids = []) => resolve({
        source,
        allPage: 1,
        total: ids.length,
        limit: 30,
        list: ids.map(id => ({ id, source, name: id, author: 'Fixture', singer: 'Fixture', meta: { albumName: 'Fixture' } })),
      }),
    }))
    return [source, { musicSearch: { search }, songList: { search }, entitySearch: { search } }]
  }))
  const load = require('./helpers/load-typescript.cjs')({
    '@common/utils/vueTools': { markRaw: value => value, markRawList: value => value },
    '@renderer/store/setting': { appSetting: { 'list.loadingMode': mode } },
    '@renderer/utils/musicSdk': music,
    '@renderer/utils': { deduplicationList: list => [...new Map(list.map(item => [item.id, item])).values()], toNewMusicInfo: value => value },
    '@common/utils/common': { sortInsert: (list, item) => list.push(item), similar: () => 1 },
    './state': { sources: [...platforms, 'all'], maxPages: {}, listInfos: entity ? { [kind]: listInfos } : listInfos },
  })
  const store = load(`src/renderer/store/search/${entity ? 'entity' : kind}/action.ts`)
  return {
    calls,
    list: listInfos.all,
    search: text => entity ? store.search(kind, text, 1, 'all') : store.search(text, 1, 'all'),
    retry: () => entity ? store.retryFailedSources(kind) : store.retryFailedSources(),
  }
}

for (const kind of ['music', 'songlist', 'singer', 'album']) {
  test(`${kind}: one retry reloads every failed platform and preserves successful results`, async() => {
    const f = fixture(kind)
    const search = f.search('query')
    await flush()
    f.calls[0].finish(['kept'])
    for (const call of f.calls.slice(1)) call.reject(Error('offline'))
    await search
    assert.equal(f.list.aggregate.status, 'partial')
    assert.deepEqual(f.list.aggregate.failedSources, platforms.slice(1))
    const retry = f.retry()
    const duplicate = f.retry()
    await flush()
    assert.equal(f.calls.length, 9)
    assert.deepEqual(f.calls.slice(5).map(call => call.source), platforms.slice(1))
    assert.deepEqual(f.list.list.map(item => item.id), ['kept'])
    assert.equal(f.list.noItemLabel, '', 'successful rows remain visible during retry')
    f.calls[5].finish(['recovered'])
    f.calls[6].reject(Error('still offline'))
    await flush()
    await f.retry()
    assert.equal(f.calls.length, 9, 'another click cannot start a second batch before this one finishes')
    for (const call of f.calls.slice(7)) call.reject(Error('still offline'))
    await Promise.all([retry, duplicate])
    assert.deepEqual(new Set(f.list.list.map(item => item.id)), new Set(['kept', 'recovered']))
    assert.deepEqual(f.list.aggregate.failedSources, platforms.slice(2))
    const remaining = f.retry()
    await flush()
    assert.deepEqual(f.calls.slice(9).map(call => call.source), platforms.slice(2))
    for (const call of f.calls.slice(9)) call.finish([])
    await remaining
    assert.equal(f.list.aggregate.status, 'success')
    assert.deepEqual(f.list.aggregate.failedSources, [])
  })

  test(`${kind}: all failures, partial empty results and genuine empty results are distinguishable`, async() => {
    const f = fixture(kind)
    const search = f.search('query')
    await flush()
    for (const call of f.calls) call.reject(Error('offline'))
    await search
    assert.equal(f.list.aggregate.status, 'failed')
    assert.equal(f.list.noItemLabel, 'list__load_failed')
    const retry = f.retry()
    await flush()
    assert.equal(f.list.noItemLabel, 'list__loading', 'retrying failed platforms must not flash an empty result')
    f.calls[5].finish([])
    for (const call of f.calls.slice(6)) call.reject(Error('still offline'))
    await retry
    assert.equal(f.list.aggregate.status, 'partial')
    assert.notEqual(f.list.noItemLabel, 'no_item')
    const rest = f.retry()
    await flush()
    for (const call of f.calls.slice(10)) call.finish([])
    await rest
    assert.equal(f.list.aggregate.status, 'empty')
    assert.equal(f.list.noItemLabel, 'no_item')
  })

  test(`${kind}: a late retry cannot overwrite a newer search or its failure state`, async() => {
    const f = fixture(kind)
    const first = f.search('old')
    await flush()
    f.calls[0].reject(Error('offline'))
    for (const call of f.calls.slice(1)) call.finish(['old'])
    await first
    const retry = f.retry()
    await flush()
    const next = f.search('new')
    await flush()
    for (const call of f.calls.slice(6)) call.finish(['new'])
    await next
    f.calls[5].finish(['stale'])
    await retry
    assert(f.list.list.every(item => item.id === 'new'))
    assert.equal(f.list.aggregate.status, 'success')
  })

  test(`${kind}: immediate mode publishes each platform while slower or failed requests remain pending`, async() => {
    const f = fixture(kind)
    let finished = false
    const search = f.search('query').then(() => { finished = true })
    await flush()
    assert.equal(f.list.list.length, 0)
    assert.equal(f.list.noItemLabel, 'list__loading')
    f.calls[0].finish([])
    await flush()
    assert.equal(f.list.noItemLabel, 'list__loading', 'One empty platform must not prematurely show an empty result')
    f.calls[1].finish(['first'])
    await flush()
    assert.deepEqual(f.list.list.map(item => item.id), ['first'])
    assert.equal(finished, false)
    f.calls[2].finish(['second'])
    await flush()
    assert.deepEqual(new Set(f.list.list.map(item => item.id)), new Set(['first', 'second']))
    assert.equal(f.list.noItemLabel, 'list__loading')
    f.calls[3].reject(Error('provider unavailable'))
    f.calls[4].finish([])
    await search
    assert.deepEqual(new Set(f.list.list.map(item => item.id)), new Set(['first', 'second']))
    assert.equal(f.list.noItemLabel, '')
  })

  test(`${kind}: existing modes still wait for all platform data`, async() => {
    for (const mode of ['together', 'progressive']) {
      const f = fixture(kind, mode)
      const search = f.search('query')
      await flush()
      f.calls[0].finish(['first'])
      await flush()
      assert.equal(f.list.list.length, 0)
      assert.equal(f.list.noItemLabel, 'list__loading')
      for (const call of f.calls.slice(1)) call.finish([])
      await search
      assert.deepEqual(f.list.list.map(item => item.id), ['first'])
    }
  })

  test(`${kind}: replacing or clearing a query rejects stale batches even after returning to the same keyword`, async() => {
    const f = fixture(kind)
    const first = f.search('A')
    await flush()
    f.calls[0].finish(['old-first'])
    await flush()
    assert.equal(f.list.list.length, 1)
    const middle = f.search('B')
    await flush()
    const latest = f.search('A')
    await flush()
    assert.equal(f.list.list.length, 0)
    f.calls[10].finish(['latest'])
    for (const call of f.calls.slice(11)) call.finish([])
    await latest
    for (const call of f.calls.slice(1, 10)) call.finish(['stale-' + call.source])
    await Promise.all([first, middle])
    assert.deepEqual(f.list.list.map(item => item.id), ['latest'])
    const pending = f.search('pending')
    await flush()
    await f.search('')
    for (const call of f.calls.slice(15)) call.finish(['discarded'])
    await pending
    assert.equal(f.list.list.length, 0)
    assert.equal(f.list.noItemLabel, '')
    const empty = f.search('empty')
    await flush()
    for (const call of f.calls.slice(20)) call.finish([])
    await empty
    assert.equal(f.list.noItemLabel, 'no_item')
  })
}
