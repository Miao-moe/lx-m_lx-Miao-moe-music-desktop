const assert = require('node:assert/strict')
const { test } = require('node:test')
const { setImmediate: tick } = require('node:timers/promises')
const loader = require('./helpers/load-typescript.cjs')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }

test('F04/F10: per-platform and global limits hold; a saturated platform cannot block another', async() => {
  const { createKeyedQueue } = loader()('src/common/utils/keyedQueue.ts')
  const queue = createKeyedQueue(2, 3)
  const held = deferred()
  const active = {}, peaks = {}, started = []
  let total = 0, peak = 0
  const run = (source, id, wait = false) => queue(source, async() => {
    started.push(id); active[source] = (active[source] ?? 0) + 1
    peaks[source] = Math.max(peaks[source] ?? 0, active[source]); peak = Math.max(peak, ++total)
    try { if (wait) await held.promise; else await tick(); if (id === 'error') throw Error('one failed') }
    finally { active[source]--; total-- }
    return id
  })
  const jobs = [run('wy', 'held1', true), run('wy', 'held2', true), run('wy', 'later'), run('tx', 'fast'), run('kg', 'error').catch(error => error.message)]
  await tick(); await tick()
  assert(started.includes('fast')); assert(!started.includes('later'))
  held.resolve()
  assert.deepEqual(await Promise.all(jobs), ['held1', 'held2', 'later', 'fast', 'one failed'])
  assert(peak <= 3); assert(Object.values(peaks).every(count => count <= 2))
  assert.equal(await run('kg', 'recovered'), 'recovered')
})

test('F04/F05: automatic playlist updates make progress before a slow list and retain each failure', async() => {
  const held = deferred(), starts = [], notifications = [], states = {}, applied = []
  const lists = ['slow', 'fast', 'failed'].map(id => ({ id, name: id, source: 'wy', sourceListId: id }))
  const status = { beginSync: key => { states[key] = {} }, progressSync: (key, completed) => { states[key].completed = completed }, finishSync: (key, error) => { states[key].error = error } }
  const load = loader({
    '@renderer/utils/data': { getListUpdateInfo: async() => Object.fromEntries(lists.map(list => [list.id, { isAutoUpdate: true }])) },
    '@renderer/store/list/state': { userLists: lists }, '@renderer/store/syncStatus': status,
    '@common/loadErrorNotice': { showLoadError: error => notifications.push(error) },
    '@renderer/store/list/syncSourceList': { __esModule: true, default: async list => { starts.push(list.id); if (list.id === 'slow') await held.promise; if (list.id === 'failed') throw Error('HTTP_503'); applied.push(list.id) } },
  })
  const done = load('src/renderer/core/useApp/listAutoUpdate.ts').updatePlatformLists()
  await tick()
  assert.deepEqual(starts, ['slow', 'fast', 'failed'])
  assert.deepEqual(applied, ['fast']); assert.equal(states['platform-auto'].completed, 2)
  held.resolve()
  const result = await done
  assert.equal(result.filter(item => item.status === 'rejected').length, 1)
  assert.equal(states['platform-auto'].error.code, 'PLAYLIST_SYNC_PARTIAL')
  assert.equal(notifications.length, 1)
})

test('F06: failures preserve last success, survive restart and expose sanitized error reasons', t => {
  const old = global.window, storage = new Map()
  global.window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } }
  t.after(() => { global.window = old })
  const get = () => loader({ '@common/utils/vueTools': { reactive: value => value } })('src/renderer/store/syncStatus.ts')
  const first = get()
  first.beginSync('webdav', 'WebDAV'); first.finishSync('webdav', undefined, 12345)
  first.beginSync('webdav', 'WebDAV'); first.finishSync('webdav', { code: 'HTTP_401', message: 'https://user:password@example.test/dav/?token=secret' })
  const second = get()
  assert.equal(second.syncStatuses.webdav.lastSuccess, 12345)
  assert.equal(second.syncStatuses.webdav.state, 'failed')
  assert(second.syncStatuses.webdav.error.includes('HTTP_401'))
  assert(!second.syncStatuses.webdav.error.includes('secret'))
  second.beginSync('playlist:one', 'one')
  assert(get().syncStatuses['playlist:one'].error.includes('SYNC_INTERRUPTED'))
})

test('F07/F11: large list comparisons preserve additions, removals and rename with bounded visual output', () => {
  const load = loader(), { playlistDiff } = load('src/common/syncDiff.ts'), { describeChanges } = load('src/renderer/utils/playlistWriteback/plan.ts')
  const tracks = Array.from({ length: 20000 }, (_, index) => ({ key: String(index), name: 'Song ' + index }))
  const before = { name: 'Before', tracks }, after = { name: 'After', tracks: tracks.slice(1000).concat([{ key: 'new', name: 'New song' }]) }
  const diff = describeChanges(before, after)
  assert.equal(diff.total, 1002); assert.equal(diff.changes.length, 100)
  assert.equal(diff.changes[0].kind, 'renamed'); assert.equal(diff.changes[1].after, 'New song')
  const oldLists = { defaultList: [], loveList: [], userList: [{ id: 'one', name: 'Before', list: [{ id: 'old', name: 'Old', singer: 'One' }] }] }
  const newLists = { defaultList: [], loveList: [], userList: [{ id: 'one', name: 'After', list: [{ id: 'new', name: 'New', singer: 'Two' }] }] }
  const listDiff = playlistDiff(oldLists, newLists)
  assert.deepEqual(listDiff.changes.map(item => item.kind).sort(), ['added', 'removed', 'renamed'])
})

test('F05/F06/F11: cookie synchronization respects inclusion/exclusion and reports source lookup failures', async() => {
  const settings = { 'sync.platform.selection': JSON.stringify({ wy: { mode: 'include', ids: ['one', 'three'] } }) }
  const reads = [], users = [], statuses = {}
  let failLookup = false
  const load = loader({
    '@renderer/store/setting': { appSetting: settings },
    '@renderer/store/list/listManage/state': { userLists: users },
    '@renderer/store/list/action': { createUserList: async list => { users.push(list) }, overwriteListMusics: async() => {}, updateUserList: async() => {} },
    '@renderer/store/syncStatus': { beginSync: key => { statuses[key] = null }, progressSync() {}, finishSync: (key, error) => { statuses[key] = error ?? 'success' } },
    '@common/loadErrorNotice': { showLoadError() {} },
    './cookieManager': { COOKIE_SOURCES: ['wy'], SOURCE_NAME: { wy: '网易云' }, getCookie: () => 'fixture-cookie', hasCookie: () => true, isCookieRecognized: () => true },
    './cookiePlaylistApi': { getRemotePlaylists: async() => { if (failLookup) throw Error('lookup unavailable'); return ['one', 'two', 'three'].map(id => ({ id, name: id })) }, getRemoteSongs: async(source, cookie, list) => { reads.push(list.id); return [{ id: list.id }] } },
    './playlistWriteback': { refreshBoundPlaylist: async(id, read, apply) => apply(await read()) },
  })
  const sync = load('src/renderer/utils/cookieSync.ts').syncCookiePlaylists
  assert.equal((await sync('wy')).listCount, 2)
  assert.deepEqual(reads.sort(), ['one', 'three'])
  reads.length = 0
  settings['sync.platform.selection'] = JSON.stringify({ wy: { mode: 'exclude', ids: ['one', 'three'] } })
  assert.equal((await sync('wy')).listCount, 1)
  assert.deepEqual(reads, ['two'])
  failLookup = true
  assert.equal((await sync('wy')).error, true)
  assert.equal(statuses['cookie:wy'].message, 'lookup unavailable')
  const parse = load('src/renderer/utils/platformSyncSelection.ts').readPlatformSelection
  assert.deepEqual(parse('{bad'), {})
  assert.deepEqual(parse(JSON.stringify({ wy: { mode: 'include', ids: ['one', 'one', 5] }, fake: { mode: 'all', ids: [] } })), { wy: { mode: 'include', ids: ['one'] } })
})

test('F06: device sync waiting/reconnecting states are distinct from errors and preserve last success', () => {
  const statuses = {}, sync = { client: { status: {} }, server: { status: {} } }
  let receive
  const load = loader({
    '@common/utils/vueTools': { markRaw: value => value, onBeforeUnmount() {} },
    '@renderer/utils/ipc': { onSyncAction: callback => { receive = callback; return () => {} }, sendSyncAction() {} },
    '@renderer/store': { sync }, '@renderer/store/setting': { appSetting: {} },
    '@renderer/store/syncStatus': { syncStatuses: statuses, recordSync: (key, value) => { statuses[key] = value } },
  })
  load('src/renderer/core/useApp/useSync.ts').default()
  const send = (status, message) => receive({ params: { action: 'client_status', data: { status, message, address: [] } } })
  send(false, 'Wait syncing...')
  assert.equal(statuses['device:client_status'].state, 'running')
  send(true, '')
  const success = statuses['device:client_status'].lastSuccess
  send(false, 'Try reconnnect... (1)')
  assert.equal(statuses['device:client_status'].state, 'running')
  send(true, 'Connection failed')
  assert.equal(statuses['device:client_status'].state, 'failed')
  assert.equal(statuses['device:client_status'].lastSuccess, success)
})
