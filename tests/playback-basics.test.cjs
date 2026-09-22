const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const loader = require('./helpers/load-typescript.cjs')

for (const side of ['main', 'renderer']) {
  test(`A01 ${side}: cancellation removes adapters, including once and duplicate subscriptions`, () => {
    const emitter = new EventEmitter()
    const api = loader({ electron: { ipcMain: emitter, ipcRenderer: emitter } })(`src/common/${side}Ipc.ts`)
    let count = 0
    const fn = ({ params }) => { count += params }
    for (let i = 0; i < 50; i++) {
      api[side + 'On']('a', fn); api[side + 'Once']('a', fn); api[side + 'On']('a', fn)
      api[side + 'Off']('a', fn)
    }
    emitter.emit('a', {}, 1)
    assert.equal(count, 0)
    assert.equal(emitter.listenerCount('a'), 0)
    api[side + 'On']('a', fn); api[side + 'On']('b', fn)
    api[side + 'OffAll']('a'); emitter.emit('b', {}, 2)
    assert.equal(count, 2)
    api[side + 'OffAll']('b')
  })
  test(`A01 ${side}: cancellation during dispatch and recursive once calls remain safe`, () => {
    const emitter = new EventEmitter()
    const api = loader({ electron: { ipcMain: emitter, ipcRenderer: emitter } })(`src/common/${side}Ipc.ts`)
    let calls = 0
    const target = () => calls++
    api[side + 'On']('a', () => api[side + 'Off']('a', target))
    api[side + 'On']('a', target)
    emitter.emit('a')
    assert.equal(calls, 0)
    api[side + 'Once']('once', () => { calls++; emitter.emit('once'); throw Error('fixture') })
    assert.throws(() => emitter.emit('once'), /fixture/)
    emitter.emit('once')
    assert.equal(calls, 1)
    assert.equal(emitter.listenerCount('once'), 0)
  })
}

const { getBufferRecoveryPosition } = loader()('src/renderer/core/player/bufferRecovery.ts')
test('A02: end-of-track probes stay forward and strictly before the real end', () => {
  assert.equal(getBufferRecoveryPosition(98, 100, 6), 99)
  assert.equal(getBufferRecoveryPosition(0, 100, 3), 3)
  assert.equal(getBufferRecoveryPosition(99.9, 100, 6), null)
  for (const duration of [0, NaN, Infinity, 98]) assert.equal(getBufferRecoveryPosition(98, duration, 3), null)
})

const { createSavedPlayInfo, readSavedQueue } = loader()('src/renderer/core/player/queueSession.ts')
const item = (id, listId = 'source') => ({ musicInfo: { id, source: 'local', name: id, singer: '', meta: { filePath: `C:/${id}.mp3` } }, listId, isTempPlay: false })
test('A03: serialized snapshots preserve reordered, inserted and repeated songs without their original list', () => {
  const entries = [item('b'), item('insert', null), item('a'), item('b')]
  const info = JSON.parse(JSON.stringify(createSavedPlayInfo(entries, entries[3], 3, 'deleted-list', [entries[0]], 42, 100, -1)))
  const restored = readSavedQueue(info)
  assert.deepEqual(restored.items.map(i => i.musicInfo.id), ['b', 'insert', 'a', 'b'])
  assert.equal(restored.index, 3)
  assert.equal(info.time, 42)
  assert.deepEqual(restored.current, entries[3])
  assert.equal(restored.played[0].musicInfo.id, 'b')
  assert.equal(readSavedQueue(createSavedPlayInfo([], null, -1, null, [], 0, 0, -1)).items.length, 0)
})
test('A03: malformed or legacy snapshots safely fall back, invalid progress is normalized', () => {
  assert.equal(readSavedQueue({ listId: 'old', index: 2 }), null)
  const valid = createSavedPlayInfo([item('a')], item('a'), 20, null, [], Infinity, NaN, 0)
  assert.equal(readSavedQueue(valid).index, 0)
  assert.equal(valid.time, 0)
  for (const items of [null, [{}], [{ ...item('a'), musicInfo: { id: 'a', progress: {} } }]]) {
    assert.equal(readSavedQueue({ ...valid, queue: { ...valid.queue, items } }), null)
  }
})

test('A05: pause, queue changes and timed stop invalidate work; only explicit resume permits advancement', () => {
  const window = { lx: { isPlayedStop: false } }
  const { playbackSession: session } = require('./helpers/playback-session.cjs')(window)
  const changes = []
  const remove = session.subscribe(reason => changes.push(reason))
  const first = session.capture()
  session.invalidate('queue')
  assert.equal(session.isCurrent(first), false)
  session.pause(); assert.equal(session.canAdvance(), false)
  session.resume(); assert.equal(session.canAdvance(), true)
  const next = session.capture()
  session.timedStop()
  assert.equal(session.canAdvance(), false)
  assert.equal(session.isCurrent(next), false)
  assert.equal(window.lx.isPlayedStop, true)
  session.clearTimedStop(); assert.equal(session.canAdvance(), true)
  session.stop(); session.clearTimedStop(); assert.equal(session.canAdvance(), false)
  session.begin(); assert.equal(session.canAdvance(), true)
  remove(); session.invalidate('queue')
  assert.deepEqual(changes, ['queue', 'pause', 'timed-stop', 'stop', 'track'])
})
