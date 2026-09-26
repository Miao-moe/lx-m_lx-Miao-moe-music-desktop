const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const vue = require('vue')
const loader = require('./helpers/load-typescript.cjs')
const song = { id: 'a', name: 'a', singer: '', source: 'local', interval: '01:40', meta: {} }
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const previous = global.window
  const events = new EventEmitter(), lifecycle = new EventTarget(), cleanups = []
  global.window = { app_event: events, lx: { isPlayedStop: false }, lxData: {}, addEventListener: lifecycle.addEventListener.bind(lifecycle), removeEventListener: lifecycle.removeEventListener.bind(lifecycle) }
  events.activePlayProgressTransition = () => {}
  const session = require('./helpers/playback-session.cjs')(global.window)
  const common = { ...vue, onBeforeUnmount: fn => cleanups.push(fn) }
  const state = loader({ '@common/utils/vueTools': common })('src/renderer/store/player/state.ts')
  state.musicInfo.id = song.id
  Object.assign(state.playMusicInfo, { musicInfo: song, listId: 'source', isTempPlay: false })
  const progress = vue.reactive({ nowPlayTime: 98, maxPlayTime: 100 })
  const appSetting = vue.reactive({ 'player.autoSkipOnError': true, 'player.isSavePlayTime': true })
  let current = 98, next = 0
  const seeks = [], saved = []
  const audio = { paused: false }
  const player = { getAudioElement: () => audio, onTimeupdate: () => () => {}, onVisibilityChange: () => () => {}, getCurrentTime: () => current, getDuration: () => 100, setCurrentTime: time => { seeks.push(time); current = time } }
  const load = loader({
    '@common/utils/vueTools': common,
    '@common/utils/common': { getRandom: () => 6, formatPlayTime2: String },
    '@renderer/plugins/player': player,
    '@renderer/store/player/state': state,
    '@renderer/store/player/playProgress': { playProgress: progress, setNowPlayTime: time => { progress.nowPlayTime = time }, setMaxplayTime: time => { progress.maxPlayTime = time } },
    '@renderer/store/setting': { appSetting },
    '@renderer/core/player': { playNext: async() => { next++ } },
    '@renderer/store/list/action': {},
    '@renderer/core/player/playbackSession': session,
    '@renderer/core/player/bufferRecovery': loader()('src/renderer/core/player/bufferRecovery.ts'),
    '@renderer/core/player/queueSession': loader()('src/renderer/core/player/queueSession.ts'),
    '@renderer/utils/ipc': { savePlayInfo: info => saved.push(structuredClone(info)) },
  })
  const scope = vue.effectScope()
  t.after(() => { cleanups.forEach(fn => fn()); scope.stop(); global.window = previous })
  return { state, progress, appSetting, audio, session: session.playbackSession, events, saved, seeks, lifecycle, get next() { return next }, get current() { return current }, init: file => scope.run(() => load(file).default()), cleanup: () => cleanups.forEach(fn => fn()) }
}
test('A02: buffering near the end recovers to the original position without immediately skipping', t => {
  const f = fixture(t)
  f.init('src/renderer/core/useApp/usePlayer/usePlayProgress.ts')
  f.events.emit('playerWaiting'); t.mock.timers.tick(3000)
  assert.equal(f.current, 99)
  assert.equal(f.next, 0)
  f.events.emit('playerPlaying')
  assert.equal(f.current, 98, 'the origin must be read before the timer reset clears it')
  t.mock.timers.tick(30000)
  assert.equal(f.next, 0)
})
test('A02: repeated waiting notifications preserve the origin and the total recovery budget', t => {
  const f = fixture(t)
  f.init('src/renderer/core/useApp/usePlayer/usePlayProgress.ts')
  f.events.emit('playerWaiting'); t.mock.timers.tick(3000)
  f.events.emit('pause'); f.events.emit('playerWaiting'); t.mock.timers.tick(3000)
  f.events.emit('playerPlaying')
  assert.equal(f.current, 98)
  for (let i = 0; i < 10; i++) {
    f.events.emit('pause'); f.events.emit('playerWaiting'); t.mock.timers.tick(3000)
  }
  assert.equal(f.next, 1)
})
test('A02: an actual media pause cancels buffering even without an explicit player command', t => {
  const f = fixture(t)
  f.init('src/renderer/core/useApp/usePlayer/usePlayProgress.ts')
  f.events.emit('playerWaiting')
  f.audio.paused = true; f.events.emit('pause')
  t.mock.timers.tick(30000)
  assert.equal(f.next, 0)
  assert.deepEqual(f.seeks, [])
})
for (const reason of ['pause', 'stop', 'timed-stop', 'unmount']) {
  test(`A02/A05: ${reason} prevents a pending buffer recovery from changing playback`, t => {
    const f = fixture(t)
    f.init('src/renderer/core/useApp/usePlayer/usePlayProgress.ts')
    f.events.emit('playerWaiting')
    if (reason === 'unmount') f.cleanup()
    else if (reason === 'timed-stop') f.session.timedStop()
    else f.session[reason]()
    t.mock.timers.tick(60000)
    assert.deepEqual(f.seeks, [])
    assert.equal(f.next, 0)
  })
}
test('A03: queue edits save while paused, progress is coalesced, and unload flushes the latest position', async t => {
  const f = fixture(t)
  f.init('src/renderer/core/useApp/usePlayer/usePlaybackPersistence.ts')
  f.progress.nowPlayTime = 10
  await vue.nextTick(); t.mock.timers.tick(3000)
  assert.equal(f.saved.length, 0, 'startup must not overwrite the previous session before restoration')
  f.state.playQueueList.push({ musicInfo: song, listId: null, isTempPlay: false })
  f.state.playInfo.playerPlayIndex = 0
  f.state.playbackReady.value = true
  await vue.nextTick()
  assert.equal(f.saved.at(-1).queue.items[0].musicInfo.id, 'a')
  f.state.playQueueList.push({ musicInfo: { ...song, id: 'insert' }, listId: null, isTempPlay: false })
  f.state.playQueueRevision.value++
  await vue.nextTick()
  assert.equal(f.saved.at(-1).queue.items.length, 2)
  const count = f.saved.length
  f.progress.nowPlayTime = 11; await vue.nextTick()
  f.progress.nowPlayTime = 12; await vue.nextTick()
  assert.equal(f.saved.length, count)
  f.lifecycle.dispatchEvent(new Event('beforeunload'))
  assert.equal(f.saved.at(-1).time, 12)
  t.mock.timers.tick(3000)
  assert.equal(f.saved.length, count + 1)
  f.state.playQueueList.splice(0); f.state.playQueueRevision.value++
  Object.assign(f.state.playMusicInfo, { musicInfo: null, listId: null })
  await vue.nextTick()
  assert.equal(f.saved.at(-1).queue.items.length, 0)
  assert.equal(f.saved.at(-1).queue.current, null)
})

test('download tasks in the playback queue are cloneable when playback is saved', async t => {
  const f = fixture(t)
  f.init('src/renderer/core/useApp/usePlayer/usePlaybackPersistence.ts')
  const task = vue.reactive({
    id: 'download-1', status: 'completed', name: 'Download task',
    metadata: vue.reactive({ musicInfo: vue.reactive({ ...song, id: 'download-song', meta: { albumName: 'Album' } }), filePath: 'C:\\music\\song.mp3' }),
  })
  f.state.playQueueList.push({ musicInfo: task, listId: 'download', isTempPlay: false })
  Object.assign(f.state.playMusicInfo, { musicInfo: task, listId: 'download', isTempPlay: false })
  f.state.playbackReady.value = true
  await vue.nextTick()
  const saved = f.saved.at(-1)
  assert.equal(saved.queue.items[0].musicInfo.metadata.musicInfo.id, 'download-song')
  assert.equal(saved.queue.current.musicInfo.metadata.filePath, 'C:\\music\\song.mp3')
  assert.equal(saved.queue.items[0].musicInfo.metadata.musicInfo.meta.albumName, 'Album')
})
