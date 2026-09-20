const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const load = (filename, imports, globals = {}) => {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    console,
    setTimeout,
    window: { i18n: { t: key => key } },
    ...globals,
    require: name => { assert(Object.hasOwn(imports, name), name); return imports[name] },
  }, { filename })
  return module.exports
}
const { buildDesktopSearchRequest } = require('./helpers/load-search-sdk.cjs')(() => {}).load('musicSdk/tx/searchFallback.js')
const deferred = () => { let resolve, reject; const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject }); return { promise, resolve, reject } }
const flush = () => new Promise(resolve => setImmediate(resolve))
const success = (songs = []) => ({ statusCode: 200, body: { code: 0, req: { code: 0, data: { body: { song: { list: songs } }, meta: { sum: songs.length } } } } })
const rejected = () => ({ statusCode: 200, body: { code: 0, req: { code: 2001, data: { body: { item_song: [] } } } } })
const messages = { cancelRequest: '取消http请求', timeout: '请求超时', notConnectNetwork: '无法连接到服务器', unachievable: '接口无法访问' }

function sdkFixture(respond) {
  const calls = []; const waits = []; const logs = []
  const shared = load('src/renderer/utils/musicSdk/searchFallback.js', { '../message': { requestMsg: messages } })
  const sdk = load('src/renderer/utils/musicSdk/tx/musicSearch.js', {
    '../../index': { formatPlayTime: String, sizeFormate: String },
    '../utils': { formatSingerName: () => '' },
    '../../message': { requestMsg: messages },
    '../searchFallback': shared,
    './searchFallback': { buildDesktopSearchRequest, mobileSearch: async() => { throw new Error('mobile unavailable') }, smartboxSearch: async() => { throw new Error('suggestions unavailable') } },
    './utils': { signRequest: async payload => { calls.push(payload); return respond(calls.length, payload) } },
  }, { console: { warn: (...args) => logs.push(args.join(' ')) }, setTimeout: (callback, ms) => { waits.push(ms); queueMicrotask(callback) } }).default
  return { sdk, calls, waits, logs }
}

test('a transient QQ 2001 reply recovers after a delay with the original keyword and page', async() => {
  const f = sdkFixture(count => count === 1 ? rejected() : success())
  const result = await f.sdk.musicSearch('Talullah Jamiroquai', 2, 30)
  assert.equal(result.body.song.list.length, 0)
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.waits, [700])
  for (const call of f.calls) {
    assert.equal(call['music.search.SearchCgiService'].param.query, 'Talullah Jamiroquai')
    assert.equal(call['music.search.SearchCgiService'].param.page_num, 2)
    assert.equal(call['music.search.SearchCgiService'].param.num_per_page, 30)
  }
})

test('persistent failure is bounded and retains HTTP and QQ error codes', async() => {
  const f = sdkFixture(rejected)
  await assert.rejects(f.sdk.musicSearch('private keyword', 1, 30), /HTTP 200, code 0, req.code 2001/)
  assert.equal(f.calls.length, 6)
  assert.deepEqual(f.waits, [700, 1500, 1500, 1500, 1500])
  assert.equal(f.logs.length, 6)
  assert(!f.logs.join('').includes('private keyword'))
})

test('QQ 2001 can recover on the fifth or sixth attempt, matching the official LX allowance', async() => {
  for (const successAttempt of [5, 6]) {
    const f = sdkFixture(count => count < successAttempt ? rejected() : success([{ id: 'recovered' }]))
    const result = await f.sdk.musicSearch('Talullah Jamiroquai', 1, 30)
    assert.equal(f.calls.length, successAttempt)
    assert.equal(result.body.song.list[0].id, 'recovered')
    assert.equal(f.waits.length, successAttempt - 1)
  }
})

test('network and other business failures retain the shorter retry budget', async() => {
  for (const respond of [
    () => { throw new Error(messages.timeout) },
    () => ({ statusCode: 503 }),
    () => ({ statusCode: 200, body: { code: 0, req: { code: 1000 } } }),
  ]) {
    const f = sdkFixture(respond)
    await assert.rejects(f.sdk.musicSearch('song', 1, 30))
    assert.equal(f.calls.length, 3)
    assert.deepEqual(f.waits, [700, 1500])
  }
})

test('repeated clicks share one pending SDK request, including its retries', async() => {
  const gate = deferred()
  const f = sdkFixture(count => count === 1 ? gate.promise : success())
  const first = f.sdk.musicSearch('same', 1, 30)
  const second = f.sdk.musicSearch('same', 1, 30)
  assert.equal(first, second)
  assert.equal(f.calls.length, 1)
  gate.resolve(rejected())
  await Promise.all([first, second])
  assert.equal(f.calls.length, 2)
})

test('a completed failure can be retried and distinct pages do not share requests', async() => {
  const f = sdkFixture(count => count <= 6 ? rejected() : success())
  await assert.rejects(f.sdk.musicSearch('same', 1, 30))
  await Promise.all([f.sdk.musicSearch('same', 1, 30), f.sdk.musicSearch('same', 2, 30)])
  assert.equal(f.calls.length, 8)
})

test('temporary network errors retry but cancellation and HTTP 403 stop', async() => {
  const temporary = sdkFixture(count => { if (count === 1) throw new Error(messages.timeout); return success() })
  await temporary.sdk.musicSearch('song', 1, 30)
  assert.equal(temporary.calls.length, 2)
  for (const respond of [() => { throw new Error(messages.cancelRequest) }, () => ({ ...success(), statusCode: 403 })]) {
    const f = sdkFixture(respond)
    await assert.rejects(f.sdk.musicSearch('song', 1, 30))
    assert.equal(f.calls.length, 1)
    assert.deepEqual(f.waits, [])
  }
})

test('HTTP 429 honors a short Retry-After and does not rapidly retry a long one', async() => {
  const short = sdkFixture(count => count === 1 ? { statusCode: 429, headers: { 'retry-after': '2' } } : success())
  await short.sdk.musicSearch('song', 1, 30)
  assert.deepEqual(short.waits, [2000])
  const long = sdkFixture(() => ({ statusCode: 429, headers: { 'retry-after': '60' } }))
  await assert.rejects(long.sdk.musicSearch('song', 1, 30), /HTTP 429/)
  assert.equal(long.calls.length, 1)
})

test('malformed successful replies are retried and a valid empty result is accepted', async() => {
  const f = sdkFixture(count => count === 1 ? { statusCode: 200, body: { code: 0, req: { code: 0, data: null } } } : success())
  const result = await f.sdk.search('song', 1, 30)
  assert.equal(result.list.length, 0)
  assert.equal(result.total, 0)
  assert.equal(f.calls.length, 2)
})

test('diagnostics omit response bodies, account data and arbitrary error messages', async() => {
  const secret = 'SECRET_COOKIE_AND_KEYWORD'
  const f = sdkFixture(() => ({ statusCode: 403, body: { code: 1, message: secret, req: { code: 2001, data: { cookie: secret } } } }))
  await assert.rejects(f.sdk.musicSearch(secret, 1, 30), error => !error.message.includes(secret))
  assert(!f.logs.join('').includes(secret))
  const network = sdkFixture(() => { throw new Error('https://example.test/?cookie=' + secret) })
  await assert.rejects(network.sdk.musicSearch(secret, 1, 30), error => !error.message.includes(secret))
  assert(!network.logs.join('').includes(secret))
})

function storeFixture() {
  const calls = []
  const make = () => ({ list: [], key: null, page: 0, maxPage: 0, total: 0, limit: 30, noItemLabel: '' })
  const listInfos = { tx: make(), all: make() }
  const store = load('src/renderer/store/search/music/action.ts', {
    '../aggregate': load('src/renderer/store/search/aggregate.ts', { '@renderer/store/setting': { appSetting: { 'list.loadingMode': 'together' } } }),
    '@renderer/store/setting': { appSetting: { 'list.loadingMode': 'together' } },
    '@common/utils/vueTools': { markRaw: value => value },
    '@renderer/utils/musicSdk': { tx: { musicSearch: { search: (text, page) => { const gate = deferred(); calls.push({ text, page, ...gate }); return gate.promise } } } },
    '@renderer/utils': { deduplicationList: value => value, toNewMusicInfo: value => value },
    '@common/utils/common': { sortInsert: (list, item) => list.push(item), similar: () => 1 },
    './state': { listInfos, sources: ['tx', 'all'], maxPages: {} },
  }, { console: { log() {} } })
  const result = name => ({ source: 'tx', list: [{ id: name, name, singer: 'Artist' }], total: 1, limit: 30, allPage: 1 })
  return { ...store, calls, listInfos, result }
}

test('the search store coalesces repeated clicks and caches only completed results', async() => {
  const f = storeFixture()
  const a = f.search('A', 1, 'tx'); const b = f.search('A', 1, 'tx')
  await flush()
  assert.equal(f.calls.length, 1)
  f.calls[0].resolve(f.result('A'))
  await Promise.all([a, b])
  await f.search('A', 1, 'tx')
  assert.equal(f.calls.length, 1)
  const c = f.search('B', 1, 'tx'); const d = f.search('B', 1, 'tx')
  assert.equal(f.listInfos.tx.list.length, 0)
  await flush()
  assert.equal(f.calls.length, 2)
  f.calls[1].resolve(f.result('B'))
  const lists = await Promise.all([c, d])
  assert(lists.every(list => list[0].id === 'B'))
})

test('an older A failure cannot erase a newer A result after switching through B', async() => {
  const f = storeFixture()
  const first = f.search('A', 1, 'tx')
  await flush()
  const middle = f.search('B', 1, 'tx')
  await flush()
  const latest = f.search('A', 1, 'tx')
  await flush()
  f.calls[2].resolve(f.result('latest A'))
  await latest
  f.calls[0].reject(new Error('old failure'))
  f.calls[1].resolve(f.result('old B'))
  await Promise.all([first, middle])
  assert.equal(f.listInfos.tx.list[0].id, 'latest A')
  assert.equal(f.listInfos.tx.noItemLabel, '')
})

test('clearing a pending search prevents its late result from returning', async() => {
  const f = storeFixture()
  const pending = f.search('A', 1, 'tx')
  await flush()
  await f.search('', 1, 'tx')
  f.calls[0].resolve(f.result('A'))
  await pending
  assert.equal(f.listInfos.tx.list.length, 0)
  assert.equal(f.listInfos.tx.key, null)
})

test('a failed search displays retry state and a later click can succeed', async() => {
  const f = storeFixture()
  const pending = f.search('A', 1, 'tx')
  const failure = assert.rejects(pending)
  await flush()
  f.calls[0].reject(new Error('QQ rejected the query'))
  await failure
  assert.equal(f.listInfos.tx.noItemLabel, 'list__load_failed')
  const retry = f.search('A', 1, 'tx')
  await flush()
  f.calls[1].resolve(f.result('A'))
  await retry
  assert.equal(f.listInfos.tx.list[0].id, 'A')
})

test('all-source search also suppresses duplicates and stale results', async() => {
  const f = storeFixture()
  const a = f.search('A', 1, 'all'); const b = f.search('A', 1, 'all')
  await flush()
  assert.equal(f.calls.length, 1)
  const latest = f.search('B', 1, 'all')
  await flush()
  f.calls[1].resolve(f.result('B'))
  await latest
  f.calls[0].resolve(f.result('A'))
  await Promise.all([a, b])
  assert.equal(f.listInfos.all.list[0].id, 'B')
})
