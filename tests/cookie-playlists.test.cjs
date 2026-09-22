const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const cookies = {
  wy: 'MUSIC_U=test-session',
  tx: 'uin=7; qqmusic_key=test-session',
  kg: 'KuGoo=KugooID=7&t=test-session; kg_mid=test-device',
  kw: 'userid=7; kw_token=test-csrf',
  mg: 'migu_music_sid=test-session; USER_ID=7',
}

function load(file, imports) {
  const filename = path.join(root, file)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  const execute = vm.runInThisContext('(function(require, module, exports, console) {' + code + '\n})', { filename })
  execute(name => {
    if (name === '@common/utils/errorMessage' || name === '@common/loadErrorNotice') return require('./helpers/load-typescript.cjs')()('src/common/' + name.slice(8) + '.ts')
    assert(Object.hasOwn(imports, name), 'Unexpected dependency: ' + name)
    return imports[name]
  }, module, module.exports, { warn() {} })
  return module.exports
}

function fixture({ sources = Object.keys(cookies), respond, sdk = {} } = {}) {
  const appSetting = Object.fromEntries(sources.map(source => ['cookie.' + source, cookies[source]]))
  const manager = load('src/renderer/utils/cookieManager.ts', { '@renderer/store/setting': { appSetting } })
  const requests = []
  const writes = []
  const actions = Object.fromEntries(['createUserList', 'overwriteListMusics', 'updateUserList'].map(name => [name, async(data) => { writes.push({ name, data }) }]))
  const api = load('src/renderer/utils/cookiePlaylistApi.ts', {
    '@renderer/utils/cookieManager': manager,
    '@renderer/utils': { deduplicationList: items => items, toNewMusicInfo: item => item },
    '@renderer/utils/musicSdk': sdk,
    '@renderer/utils/musicSdk/wy/utils/crypto': { eapi: (url, params) => ({ url, params }) },
    '@renderer/utils/musicSdk/utils': { toMD5: () => 'test-signature' },
    '@renderer/utils/request': {
      httpFetch(url, options) {
        requests.push({ url, options })
        return { promise: Promise.resolve().then(() => respond(url, options)) }
      },
    },
  })
  const sync = load('src/renderer/utils/cookieSync.ts', {
    '@renderer/store/setting': { appSetting },
    '@renderer/store/syncStatus': { beginSync() {}, progressSync() {}, finishSync() {} },
    './syncQueue': require('./helpers/load-typescript.cjs')()('src/renderer/utils/syncQueue.ts'),
    './platformSyncSelection': require('./helpers/load-typescript.cjs')()('src/renderer/utils/platformSyncSelection.ts'),
    '@renderer/store/list/action': actions,
    '@renderer/store/list/listManage/state': { userLists: [] },
    './cookieManager': manager,
    './cookiePlaylistApi': api,
    './playlistWriteback': { refreshBoundPlaylist: async(_id, read, apply) => apply(await read()) },
  })
  return { sync, manager, requests, writes, appSetting }
}

const response = body => ({ statusCode: 200, body })
function playlistResponse(url, options, empty = false) {
  if (url.includes('music.163.com')) {
    if (options.form.url.endsWith('/account/get')) return response({ code: 200, account: { id: 7 } })
    return response({ code: 200, playlist: empty ? [] : [
      { id: 11, name: 'My playlist', creator: { userId: 7 } },
      { id: 12, name: 'Another user', creator: { userId: 8 } },
    ] })
  }
  if (url.includes('c.y.qq.com')) return response({ code: 0, data: { disslist: empty ? [] : [{ tid: 21, diss_name: 'My playlist' }] } })
  if (url.includes('kugou.com')) return response({ status: 1, error_code: 0, data: { list_count: empty ? 0 : 1, info: empty ? [] : [{ listid: 31, type: 0, is_def: 0, name: 'My playlist' }] } })
  if (url.includes('kuwo.cn')) return response({ result: 'ok', plist: empty ? [] : [{ id: 41, uid: 7, type: 'GENERAL', title: 'My playlist' }] })
  if (url.includes('migu.cn')) return response({ data: { myCreatedMusicLists: { createdMusicLists: empty ? [] : [{ musicListId: 51, title: 'My playlist' }] } } })
  throw Error('Unexpected endpoint')
}

test('personal playlist checks parse all five platforms without changing local playlists', async() => {
  const { sync, writes } = fixture({ respond: playlistResponse })
  for (const source of Object.keys(cookies)) {
    assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'success', listCount: 1 })
  }
  assert.deepEqual(writes, [])
})

test('unconfigured platforms are reported without network requests', async() => {
  const { sync, requests, writes } = fixture({ sources: [] })
  for (const source of Object.keys(cookies)) {
    assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'missing_cookie', listCount: 0 })
  }
  assert.deepEqual(requests, [])
  assert.deepEqual(writes, [])
})

test('anonymous tracking and CSRF cookies are not treated as playlist login credentials', async() => {
  const { manager } = fixture()
  assert.equal(manager.isCookieValid('wy', '__csrf=tracking-only'), false)
  assert.equal(manager.isCookieValid('kg', 'kg_mid=device-only; kg_user_v=tracking-only'), false)
  assert.equal(manager.isCookieValid('kw', 'kw_token=csrf-only; Hm_lvt_123=tracking-only'), false)
})

test('an expired NetEase login is distinguished from an empty playlist collection', async() => {
  const { sync } = fixture({ respond: () => response({ code: 200, account: null, profile: null }) })
  assert.equal((await sync.checkCookiePlaylists('wy')).status, 'login_expired')
})

test('NetEase personal playlist checks authenticate client cookies and recognize explicit expiry', async() => {
  const { sync, requests } = fixture({ sources: ['wy'], respond: (url, options) => {
    if (url.endsWith('/api/linux/forward')) return response({ code: 200, account: null, profile: null })
    assert.equal(new URL(url).origin, 'https://interfacepc.music.163.com')
    assert.equal(options.form.params.header.MUSIC_U, 'test-session')
    return playlistResponse(url, options)
  } })
  assert.equal((await sync.checkCookiePlaylists('wy')).status, 'success')
  assert.equal(requests.length, 2)
  const expired = fixture({ sources: ['wy'], respond: () => response({ code: 301 }) })
  assert.equal((await expired.sync.checkCookiePlaylists('wy')).status, 'login_expired')
})

test('HTTP errors, malformed responses and network failures are never reported as empty success', async() => {
  for (const respond of [
    () => ({ statusCode: 503, body: {} }),
    () => response({ status: 1, error_code: 0, data: {} }),
    () => { throw Error('network timeout') },
  ]) {
    const { sync, writes } = fixture({ respond })
    for (const source of Object.keys(cookies)) assert.equal((await sync.checkCookiePlaylists(source)).status, 'failed')
    assert.deepEqual(writes, [])
  }
})

test('empty personal collections succeed on all platforms, including the sync summary', async() => {
  const { sync, writes } = fixture({ respond: (url, options) => playlistResponse(url, options, true) })
  for (const source of Object.keys(cookies)) assert.deepEqual(await sync.checkCookiePlaylists(source), { source, status: 'success', listCount: 0 })
  const summary = await sync.syncAllPlaylists()
  assert.equal(summary.synced, true)
  assert.equal(summary.error, false)
  assert.equal(summary.details.length, 5)
  assert(summary.details.every(detail => detail.status === 'success' && detail.listCount === 0))
  assert.deepEqual(writes, [])
})

test('Kugou pagination continues when the first page contains only excluded lists', async() => {
  const { sync, requests } = fixture({ respond: (url, options) => {
    const { page } = JSON.parse(options.body)
    return response({ status: 1, error_code: 0, data: {
      list_count: 2,
      info: page === 1
        ? [{ listid: 31, type: 1, is_def: 0, name: 'Subscribed' }]
        : [{ listid: 32, type: 0, is_def: 0, name: 'Created' }],
    } })
  } })
  assert.equal((await sync.checkCookiePlaylists('kg')).listCount, 1)
  assert.equal(requests.length, 2)
})

test('invalid song responses cannot overwrite local lists or make an all-failed sync succeed', async() => {
  const { sync, writes } = fixture({ sources: ['kg'], respond: (url, options) => url.includes('/v4/')
    ? response({ status: 1, error_code: 0, data: {} })
    : playlistResponse(url, options),
  })
  const summary = await sync.syncAllPlaylists()
  assert.equal(summary.synced, false)
  assert.equal(summary.error, true)
  assert.equal(summary.details[0].status, 'failed')
  assert.deepEqual(writes, [])
})
