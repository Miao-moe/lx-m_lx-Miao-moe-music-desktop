const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { createWritebackEngine } = load('src/renderer/utils/playlistWriteback/engine.ts')
const { localPlaylistSnapshot } = load('src/renderer/utils/playlistWriteback/snapshot.ts')
const { withLocalListLocks } = load('src/renderer/store/list/localMutationLock.ts')
const clone = value => JSON.parse(JSON.stringify(value))
const snapshot = (keys, name = 'My list') => ({ name, tracks: keys.map(key => ({ key })) })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture(t, initial = {}) {
  const state = {
    local: { source: 'wy', remoteId: '123', snapshot: snapshot(['a', 'b']) },
    remote: snapshot(['a', 'b']), ownerId: '7', saved: null, calls: [], statuses: {},
    ...initial,
  }
  const engine = createWritebackEngine({
    load: async() => { if (state.onLoad) await state.onLoad(); return clone(state.saved) },
    save: async saved => {
      if (state.onSave) await state.onSave(saved)
      if (state.failSave) throw Error('disk unavailable')
      state.saved = clone(saved)
    },
    local: async() => clone(state.local),
    status: (id, status) => { state.statuses[id] = status },
    lockLocal: async(id, task) => withLocalListLocks([id], task),
    open: async() => {
      if (state.failOpen) throw Error('offline')
      let guard = () => {}
      const ownerId = state.ownerId
      return {
        ownerId: state.ownerId, capabilities: state.capabilities ?? { rename: true, order: true },
        setGuard: check => { guard = check },
        assertActive: () => { guard(); if (state.ownerId !== ownerId) throw Error('account changed') },
        read: async() => clone(state.remote),
        add: async tracks => {
          guard()
          assert(state.saved.lists.list.inFlight, 'intent must be durable before a write')
          state.calls.push(['add', tracks.map(track => track.key)])
          state.remote.tracks.push(...clone(tracks))
          if (state.onAdd) await state.onAdd()
        },
        remove: async tracks => {
          guard()
          state.calls.push(['remove', tracks.map(track => track.key)])
          state.remote.tracks = state.remote.tracks.filter(track => !tracks.some(item => item.key === track.key))
        },
        rename: async name => { guard(); state.calls.push(['rename', name]); state.remote.name = name },
        order: async keys => {
          guard()
          state.calls.push(['order', keys])
          state.remote.tracks = keys.map(key => state.remote.tracks.find(track => track.key === key))
          if (state.onOrder) await state.onOrder()
        },
      }
    },
  })
  t.after(() => engine.dispose())
  return { state, engine }
}

test('disabled by default, enabling establishes a baseline without uploading earlier local edits', async t => {
  const { engine, state } = fixture(t, { remote: snapshot(['remote-only']) })
  await engine.run('list')
  assert.deepEqual(state.calls, [])
  await engine.setEnabled('list', true)
  await engine.run('list')
  assert.deepEqual(state.calls, [])
  assert.equal(state.saved.lists.list.enabled, true)
  assert.equal(state.saved.lists.list.ownerId, '7')
  assert(!JSON.stringify(state.saved).includes('cookie'))
})

test('F08: unchanged writeback runs neither persist the entire binding store nor open a session', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  let saves = 0
  state.onSave = async() => { saves++ }
  state.failOpen = true
  for (let index = 0; index < 10; index++) await engine.run('list')
  assert.equal(saves, 0)
  assert.notEqual(state.statuses.list.state, 'failed')
})

test('F08: refreshing an unchanged remote playlist does not serialize saved bindings again', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  let saves = 0
  state.onSave = async() => { saves++ }
  await engine.refresh('list', async() => clone(state.remote), async data => { state.local.snapshot = data })
  assert.equal(saves, 0)
})

test('F09: an initialization failure can be retried after storage becomes available', async t => {
  let calls = 0
  const { engine } = fixture(t, { onLoad: async() => { if (++calls === 1) throw Error('temporarily unavailable') } })
  await assert.rejects(engine.init(), /temporarily unavailable/)
  await Promise.all([engine.init(), engine.init()])
  assert.equal(calls, 2)
  await engine.setEnabled('list', true)
})

test('F08: simultaneous changes to separate bindings coalesce into one durable save', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('one', true)
  await engine.setEnabled('two', true)
  let saves = 0
  state.onSave = async() => { saves++ }
  await Promise.all([engine.setEnabled('one', false), engine.setEnabled('two', false)])
  assert.equal(saves, 1)
  assert.equal(state.saved.lists.one.enabled, false)
  assert.equal(state.saved.lists.two.enabled, false)
})

test('only explicit local additions/removals are sent; independently added platform songs survive', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['b', 'c'], 'Renamed')
  state.remote.tracks.push({ key: 'remote-only' })
  await engine.run('list')
  assert.deepEqual(state.calls.slice(0, 3), [['add', ['c']], ['remove', ['a']], ['rename', 'Renamed']])
  assert.deepEqual(state.remote.tracks.map(track => track.key), ['b', 'remote-only', 'c'])
  assert.equal(state.statuses.list.state, 'success')
  assert.equal(state.saved.lists.list.inFlight, undefined)
})

test('unchanged local songs deleted on the platform are not resurrected', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.remote = snapshot(['b'])
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  await engine.run('list')
  assert.deepEqual(state.remote.tracks.map(track => track.key), ['b', 'c'])
})

test('failed writes survive restart; retries use readback instead of repeating successful additions', async t => {
  const first = fixture(t)
  await first.engine.setEnabled('list', true)
  first.state.local.snapshot = snapshot(['b', 'c'])
  first.state.onAdd = async() => { throw Error('response lost after commit') }
  await first.engine.run('list')
  assert.equal(first.state.statuses.list.state, 'failed')
  assert(first.state.saved.lists.list.inFlight)
  const second = fixture(t, { saved: first.state.saved, local: first.state.local, remote: first.state.remote })
  await second.engine.run('list')
  assert(!second.state.calls.some(([op]) => op === 'add'))
  assert.deepEqual(second.state.remote.tracks.map(track => track.key), ['b', 'c'])
})

test('undoing a timed-out addition removes the song that was actually accepted by the platform', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  state.onAdd = async() => { throw Error('lost response') }
  await engine.run('list')
  state.local.snapshot = snapshot(['a', 'b'])
  state.onAdd = undefined
  await engine.run('list')
  assert.deepEqual(state.remote.tracks.map(track => track.key), ['a', 'b'])
  assert(state.calls.some(([op, keys]) => op === 'remove' && keys[0] === 'c'))
})

test('pending edits block both automatic and manual cloud refresh', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a'])
  let reads = 0, applied = false
  await assert.rejects(engine.refresh('list', async() => { reads++; return [] }, async() => { applied = true }), /pending/)
  assert.equal(reads, 0)
  assert.equal(applied, false)
  assert.deepEqual(state.local.snapshot.tracks, [{ key: 'a' }])
})

test('edits made while a cloud fetch is in flight cannot be overwritten', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  const fetched = deferred(), started = deferred()
  let applied = false
  const refresh = engine.refresh('list', async() => { started.resolve(); return fetched.promise }, async() => { applied = true })
  await started.promise
  state.local.snapshot = snapshot(['a', 'b', 'new-local'])
  fetched.resolve([])
  await assert.rejects(refresh, /pending/)
  assert.equal(applied, false)
})

test('cloud refresh adopts a fresh baseline and does not echo changes back to the platform', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.remote = snapshot(['a', 'b', 'remote-song'], 'Cloud name')
  await engine.refresh('list', async() => clone(state.remote), async data => { state.local.snapshot = data })
  await engine.changed(['list'])
  await engine.run('list')
  assert.deepEqual(state.calls, [])
  assert.equal(state.saved.lists.list.local.name, 'Cloud name')
})

test('switching accounts or changing a playlist association cannot write to the wrong account', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a'])
  state.ownerId = 'different-account'
  await engine.run('list')
  assert.equal(state.statuses.list.error, 'owner')
  assert.deepEqual(state.calls, [])
  state.local.remoteId = '999'
  await engine.run('list')
  assert.deepEqual(state.calls, [])
})

test('conflicting playlist names are reported before any mutation', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['b'], 'Local title')
  state.remote.name = 'Other title'
  await engine.run('list')
  assert.equal(state.statuses.list.error, 'conflict')
  assert.deepEqual(state.calls, [])
})

test('storage failure prevents writes even after the switch was already enabled', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a'])
  state.failSave = true
  await engine.run('list')
  assert.equal(state.statuses.list.error, 'storage')
  assert.deepEqual(state.calls, [])
})

test('disabling during a request stops the remaining remote operations', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['c'])
  const started = deferred(), finish = deferred()
  state.onAdd = async() => { started.resolve(); await finish.promise }
  const run = engine.run('list')
  await started.promise
  const disable = engine.setEnabled('list', false)
  await new Promise(resolve => setImmediate(resolve))
  finish.resolve()
  await Promise.all([run, disable])
  assert.equal(state.saved.lists.list.enabled, false)
  assert(!state.calls.some(([op]) => op === 'remove'))
})

test('edits during a successful upload are retained for the next run', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  state.onAdd = async() => { state.local.snapshot = snapshot(['b', 'c', 'd']) }
  await engine.run('list')
  state.onAdd = undefined
  await engine.run('list')
  assert.deepEqual(state.remote.tracks.map(track => track.key), ['b', 'c', 'd'])
})

test('deleting local lists disables bindings without deleting platform playlists', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local = null
  await engine.changed(['list'])
  assert.equal(state.saved.lists.list.enabled, false)
  assert.deepEqual(state.calls, [])
})

test('unsupported name/order changes stay local and do not prevent song additions', async t => {
  const { engine, state } = fixture(t, { capabilities: { rename: false, order: false } })
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['b', 'a', 'c'], 'Local alias')
  await engine.run('list')
  assert.deepEqual(state.calls, [['add', ['c']]])
  assert.equal(state.remote.name, 'My list')
})

test('snapshots exclude cross-platform/local songs and preserve Migu content IDs as strings', () => {
  const list = { id: 'userlist_mg_sync_5', source: 'mg', sourceListId: '5', name: 'Migu list' }
  const result = localPlaylistSnapshot(list, [
    { id: 'mg_1', source: 'mg', meta: { songId: '1', contentId: '600919000001716438', copyrightId: 'copyright' } },
    { id: 'wy_1', source: 'wy', meta: { songId: '1' } },
    { id: 'local_1', source: 'local', meta: { songId: '1' } },
  ])
  assert.equal(result.snapshot.tracks.length, 1)
  assert.equal(result.snapshot.tracks[0].contentId, '600919000001716438')
  assert.equal(result.snapshot.ignored, 2)
  assert.equal(localPlaylistSnapshot({ ...list, source: 'kw' }, []), null)
})

test('different concurrent song reorders pause before any mutation', async t => {
  const { engine, state } = fixture(t, { local: { source: 'wy', remoteId: '123', snapshot: snapshot(['a', 'b', 'c']) }, remote: snapshot(['a', 'b', 'c']) })
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['b', 'a', 'c'])
  state.remote = snapshot(['c', 'a', 'b'])
  await engine.run('list')
  assert.equal(state.statuses.list.error, 'conflict')
  assert.deepEqual(state.calls, [])
})

test('an acknowledged reorder can be undone after a lost response', async t => {
  const { engine, state } = fixture(t, { local: { source: 'wy', remoteId: '123', snapshot: snapshot(['a', 'b', 'c']) }, remote: snapshot(['a', 'b', 'c']) })
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['b', 'a', 'c'])
  state.onOrder = async() => { throw Error('lost order response') }
  await engine.run('list')
  assert.equal(state.statuses.list.state, 'failed')
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  state.onOrder = undefined
  await engine.run('list')
  assert.equal(state.statuses.list.state, 'success')
  assert.deepEqual(state.remote.tracks.map(track => track.key), ['a', 'b', 'c'])
})

test('recovering a partial song edit does not hide an independent platform rename', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  state.onAdd = async() => { throw Error('lost response') }
  await engine.run('list')
  state.remote.name = 'Platform rename'
  state.local.snapshot.name = 'Local rename'
  state.onAdd = undefined
  await engine.run('list')
  assert.equal(state.statuses.list.error, 'conflict')
  assert.equal(state.remote.name, 'Platform rename')
})

test('switching accounts or disabling during a cloud fetch prevents the local overwrite', async t => {
  for (const action of ['account', 'disable']) {
    const { engine, state } = fixture(t)
    await engine.setEnabled('list', true)
    const started = deferred(), finish = deferred()
    let applied = false
    const refresh = engine.refresh('list', async() => { started.resolve(); return finish.promise }, async() => { applied = true })
    await started.promise
    let disable
    if (action === 'account') state.ownerId = 'new-account'
    else disable = engine.setEnabled('list', false)
    await new Promise(resolve => setImmediate(resolve))
    finish.resolve([])
    await assert.rejects(refresh)
    if (disable) await disable
    assert.equal(applied, false)
  }
})

test('backup restoration immediately stops subsequent requests and persists a disabled binding', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['c'])
  const started = deferred(), finish = deferred()
  state.onAdd = async() => { started.resolve(); await finish.promise }
  const run = engine.run('list')
  await started.promise
  state.local.snapshot = snapshot(['restored'])
  const reset = engine.changed(['list'], true)
  finish.resolve()
  await Promise.all([run, reset])
  assert.equal(state.saved.lists.list.enabled, false)
  assert(!state.calls.some(([op]) => op === 'remove'))
})

test('overlapping local commits serialize while unrelated list edits proceed', async() => {
  const finish = deferred(), started = deferred(), calls = []
  const first = withLocalListLocks(['one', 'two'], async() => { calls.push('first'); started.resolve(); await finish.promise })
  await started.promise
  const second = withLocalListLocks(['two', 'one'], async() => { calls.push('second') })
  await withLocalListLocks(['three'], async() => { calls.push('independent') })
  assert.deepEqual(calls, ['first', 'independent'])
  finish.resolve()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['first', 'independent', 'second'])
})

test('a queued disable wins over an unfinished enable', async t => {
  const { engine, state } = fixture(t)
  const started = deferred(), finish = deferred()
  state.onSave = async() => { started.resolve(); await finish.promise }
  const enable = engine.setEnabled('list', true)
  await started.promise
  const disable = engine.setEnabled('list', false)
  finish.resolve()
  await Promise.all([enable, disable])
  assert.equal(state.saved.lists.list.enabled, false)
  assert.equal(state.statuses.list.enabled, false)
})

test('a recovery storage error cannot re-enable a concurrently disabled binding', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  state.local.snapshot = snapshot(['a', 'b', 'c'])
  state.onAdd = async() => { throw Error('lost response') }
  await engine.run('list')
  state.onAdd = undefined
  const started = deferred(), finish = deferred()
  state.onSave = async() => { started.resolve(); await finish.promise; state.onSave = undefined; throw Error('disk failure') }
  const retry = engine.run('list')
  await started.promise
  const disable = engine.setEnabled('list', false)
  await new Promise(resolve => setImmediate(resolve))
  finish.resolve()
  await Promise.all([retry, disable])
  assert.equal(state.saved.lists.list.enabled, false)
  assert.equal(state.statuses.list.enabled, false)
})

test('changing the target of an otherwise identical list during a cloud fetch prevents overwriting it', async t => {
  const { engine, state } = fixture(t)
  await engine.setEnabled('list', true)
  const started = deferred(), finish = deferred()
  let applied = false
  const refresh = engine.refresh('list', async() => { started.resolve(); return finish.promise }, async() => { applied = true })
  await started.promise
  state.local.remoteId = '456'
  finish.resolve([])
  await assert.rejects(refresh, error => error.code === 'pending')
  assert.equal(applied, false)
})
