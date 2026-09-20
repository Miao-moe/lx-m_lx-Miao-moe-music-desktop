const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const vue = require('vue')

const sources = new Map()
function compile(file) {
  if (!sources.has(file)) {
    sources.set(file, ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText)
  }
  return sources.get(file)
}
const flush = async() => new Promise(setImmediate)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject })
  return { promise, resolve, reject }
}
const song = id => ({ id, name: id, singer: 'artist', source: 'test', meta: {} })
const item = id => ({ musicInfo: song(id), listId: 'source', isTempPlay: false })
const urlFor = id => `https://example.test/${id}.mp3`

function fixture(t, { fade = false, mode = 'listLoop' } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const audios = []
  const hooks = {}
  class Audio extends EventTarget {
    constructor() {
      super()
      Object.assign(this, {
        src: '',
        volume: 1,
        paused: true,
        ended: false,
        seeking: false,
        readyState: 4,
        autoplay: false,
        currentTime: 0,
        duration: 30,
        defaultPlaybackRate: 1,
        playbackRate: 1,
        preservesPitch: true,
        playCalls: 0,
        autoCanPlay: true,
      })
      audios.push(this)
    }

    play() { this.playCalls++; this.paused = false; return this.pendingPlay ?? Promise.resolve() }
    pause() { this.paused = true }
    removeAttribute(name) { if (name === 'src') this.src = '' }
    emit(name) { this.dispatchEvent(new Event(name)) }
    load() {
      if (this.src && this.autoCanPlay) queueMicrotask(() => { if (this.src) this.emit('canplay') })
    }
  }
  const primary = new Audio()
  Object.assign(primary, { src: urlFor('a'), currentTime: 12, paused: false, autoplay: true })
  const appSetting = vue.reactive({
    'player.gaplessPlayback': true,
    'player.fadeInFadeOut': fade,
    'player.fadeDuration': 800,
    'player.volume': 0.7,
    'player.maxVolume': 1,
    'player.isMute': false,
    'player.togglePlayMethod': mode,
  })
  const appEvent = new EventEmitter()
  for (const name of ['musicToggled', 'playerEnded', 'pause', 'stop']) appEvent[name] = () => appEvent.emit(name)
  const window = { lx: { isPlayedStop: false }, lxData: {}, i18n: { t: key => key }, app_event: appEvent, setTimeout, clearTimeout }
  const cleanups = []
  const common = { ...vue, onBeforeUnmount: callback => cleanups.push(callback) }
  const load = (file, imports) => {
    const exports = {}
    vm.runInNewContext(compile(file), {
      exports,
      window,
      Audio,
      Date,
      setTimeout,
      clearTimeout,
      setImmediate,
      queueMicrotask,
      console: { log() {}, warn() {} },
      require(name) { assert(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name] },
    }, { filename: file })
    return exports
  }
  const state = load('src/renderer/store/player/state.ts', { '@common/utils/vueTools': common })
  const core = {}
  const store = load('src/renderer/store/player/action.ts', {
    './state': state,
    './playProgress': { setProgress() {} },
    '@renderer/store/list/action': { getListMusicsFromCache: () => [] },
    '@renderer/store/download/state': { downloadList: [] },
    '@renderer/core/player': core,
    '@common/constants': { LIST_IDS: { DOWNLOAD: 'download' } },
    '@common/utils/vueTools': common,
    '@renderer/plugins/Toast': () => {},
    '@renderer/utils/musicCover': { getCachedCoverUrl: () => '' },
  })
  const engine = load('src/renderer/utils/gaplessPlayer.ts', { '@renderer/store/setting': { appSetting } })
  const resources = []
  const requests = []
  const history = []
  const music = {
    async getMusicUrl(request) {
      requests.push(request)
      return hooks.url ? await hooks.url(request) : urlFor(request.musicInfo.id)
    },
  }
  const player = {
    getCurrentTime: () => primary.currentTime,
    getAudioElement: () => primary,
    onTimeupdate(callback) { primary.addEventListener('timeupdate', callback); return () => primary.removeEventListener('timeupdate', callback) },
    onPlaying(callback) { primary.addEventListener('playing', callback); return () => primary.removeEventListener('playing', callback) },
    isEmpty: () => !primary.src,
    setPause: () => primary.pause(),
    setPlay: () => primary.play(),
    setStop: () => { primary.src = ''; primary.pause() },
    setResource(url) { resources.push(url); Object.assign(primary, { src: url, currentTime: 0, ended: false }) },
  }
  Object.assign(core, load('src/renderer/core/player/action.ts', {
    '@renderer/plugins/player': player,
    '@renderer/store/player/state': state,
    '@renderer/store/player/action': store,
    '@renderer/store/setting': { appSetting },
    '../music/index': music,
    './utils': {
      async filterList(args) {
        const filteredList = args.list.filter(track => !hooks.exclude?.has(track.id) && (mode !== 'random' || track.id !== args.playerMusicInfo?.id))
        const result = { filteredList, playerIndex: filteredList.findIndex(track => track.id === args.playerMusicInfo?.id) }
        if (hooks.filter) await hooks.filter(args)
        return result
      },
    },
    '@renderer/utils/message': { requestMsg: {} },
    '@renderer/utils/index': { getRandom: () => 0 },
    '@renderer/store/list/action': {},
    '@renderer/store/list/state': { loveList: { id: 'love' } },
    '@renderer/core/dislikeList': {},
    '@renderer/utils/gaplessPlayer': engine,
  }))
  store.setPlayQueue(['a', 'b', 'c'].map(item))
  store.setPlayListId(state.PLAY_QUEUE_LIST_ID)
  store.setPlayMusicInfo('source', state.playQueueList[0].musicInfo)
  const usePreload = load('src/renderer/core/useApp/usePlayer/usePreloadNextMusic.ts', {
    '@common/utils/vueTools': common,
    '@renderer/plugins/player': player,
    '@renderer/store/player/playProgress': { playProgress: { maxPlayTime: 30 } },
    '@renderer/store/player/state': state,
    '@renderer/core/player': core,
    '@renderer/core/music': music,
    '@renderer/store/setting': { appSetting },
    '@renderer/utils/gaplessPlayer': engine,
    '@renderer/utils/playHistoryReporter': { async reportPlayHistory(id) { history.push(id) } },
  }).default
  appEvent.on('playerEnded', () => { if (!engine.isGaplessTransitionActive() && !window.lx.isPlayedStop) core.playNext(true) })
  primary.addEventListener('ended', appEvent.playerEnded)
  const scope = vue.effectScope()
  scope.run(usePreload)
  t.after(() => { for (const cleanup of cleanups) cleanup(); scope.stop() })
  const advance = async ms => { t.mock.timers.tick(ms); await flush() }
  return {
    state,
    store,
    core,
    engine,
    primary,
    secondary: audios[1],
    audios,
    appSetting,
    window,
    hooks,
    resources,
    requests,
    history,
    advance,
    async preload() { primary.emit('timeupdate'); await flush() },
    async overlap() { primary.currentTime = 29.95; primary.emit('seeking'); await advance(0) },
    // Wall-clock ticks alone must not finish a track whose media clock is frozen.
    async commit() { primary.currentTime = primary.duration; await advance(fade ? 800 : 80) },
    end() { primary.ended = true; primary.paused = true; primary.emit('ended') },
  }
}

for (const fade of [false, true]) {
  const mode = fade ? 'crossfade' : 'gapless'
  for (const overlapping of [false, true]) {
    test(`${mode}: pause and resume ${overlapping ? 'during' : 'before'} overlap rearms the preloaded candidate`, async t => {
      const f = fixture(t, { fade })
      await f.preload()
      if (overlapping) await f.overlap()
      f.core.pause()
      await f.advance(20000)
      assert.equal(f.secondary.paused, true)
      assert.deepEqual(f.resources, [])
      f.core.play()
      f.primary.emit('playing')
      assert.equal(f.secondary.src, urlFor('b'))
      assert.equal(f.requests.length, 1, 'resume can reuse the already validated URL')
      await f.overlap()
      await f.commit()
      assert.deepEqual(f.resources, [urlFor('b')])
    })
  }
  for (const change of ['delete', 'insert', 'replace', 'clear', 'reorder']) {
    test(`${mode}: ${change} invalidates an already preloaded candidate`, async t => {
      const f = fixture(t, { fade })
      await f.preload()
      assert.equal(f.secondary.src, urlFor('b'))
      if (change === 'delete') f.store.removePlayQueue(1)
      if (change === 'insert') f.store.addTempPlayList([{ musicInfo: song('d'), listId: 'source' }])
      if (change === 'replace') f.store.setPlayQueue(['a', 'd'].map(item))
      if (change === 'clear') f.store.clearPlayQueue()
      if (change === 'reorder') f.store.setPlayQueue(['a', 'c', 'b'].map(item))
      assert.equal(f.secondary.src, '', 'cancel before the next event or timer runs')
      assert.equal(f.engine.isGaplessTransitionActive(), false)
      await f.preload()
      if (change === 'clear') {
        assert.equal(f.secondary.src, '')
        assert.deepEqual(f.resources, [])
        return
      }
      const expected = ['insert', 'replace'].includes(change) ? 'd' : 'c'
      assert.equal(f.secondary.src, urlFor(expected))
      await f.overlap()
      await f.commit()
      assert.deepEqual(f.resources, [urlFor(expected)])
      assert.equal(f.state.musicInfo.id, expected)
    })
  }
}

test('a removed candidate URL resolving late cannot replace a newer preload', async t => {
  const f = fixture(t)
  const oldUrl = deferred()
  f.hooks.url = ({ musicInfo }) => musicInfo.id === 'b' ? oldUrl.promise : urlFor(musicInfo.id)
  await f.preload()
  f.store.removePlayQueue(1)
  await f.preload()
  assert.equal(f.secondary.src, urlFor('c'))
  oldUrl.resolve(urlFor('b'))
  await flush()
  assert.equal(f.secondary.src, urlFor('c'))
  await f.overlap()
  await f.commit()
  assert.deepEqual(f.resources, [urlFor('c')])
})

test('cancelling an active URL probe cannot refresh or disturb the new candidate', async t => {
  const f = fixture(t)
  await f.preload()
  // Start another probe with automatic readiness disabled.
  f.appSetting['player.togglePlayMethod'] = 'list'
  f.audios[2].autoCanPlay = false
  await f.preload()
  f.store.removePlayQueue(1)
  f.audios[2].autoCanPlay = true
  await f.preload()
  await f.advance(9000)
  assert.equal(f.secondary.src, urlFor('c'))
  assert(!f.requests.some(request => request.musicInfo.id === 'b' && request.isRefresh))
})

test('a stale random lookup cannot repopulate the next-candidate cache', async t => {
  const f = fixture(t, { mode: 'random' })
  const oldFilter = deferred()
  f.hooks.filter = () => oldFilter.promise
  await f.preload()
  f.store.removePlayQueue(1)
  f.hooks.filter = null
  await f.preload()
  assert.equal(f.secondary.src, urlFor('c'))
  oldFilter.resolve()
  await flush()
  assert.equal((await f.core.getNextPlayMusicInfo()).musicInfo.id, 'c')
  await f.overlap()
  await f.commit()
  assert.deepEqual(f.resources, [urlFor('c')])
})

test('the handoff rechecks selection rules and falls back to the latest eligible track', async t => {
  const f = fixture(t)
  await f.preload()
  f.hooks.exclude = new Set(['b'])
  await f.overlap()
  f.end()
  await flush()
  assert.equal(f.state.musicInfo.id, 'c')
  assert(!f.resources.includes(urlFor('b')))
  assert.deepEqual(f.history, [], 'a rejected candidate must not report a completed handoff')
})

test('queue edits during final validation reject the old handoff even when its URL is reused', async t => {
  const f = fixture(t)
  await f.preload()
  const oldValidation = deferred()
  f.hooks.filter = () => oldValidation.promise
  await f.overlap()
  await f.commit()
  assert.equal(f.engine.isGaplessHandoffActive(), true)
  f.primary.emit('canplay')
  assert.equal(f.primary.playCalls, 0, 'do not start the primary before validation completes')
  f.store.addTempPlayList([{ musicInfo: song('d'), listId: 'source' }])
  f.hooks.filter = null
  f.hooks.url = () => urlFor('b')
  await f.preload()
  await f.overlap()
  await f.commit()
  assert.equal(f.state.musicInfo.id, 'd')
  oldValidation.resolve()
  await flush()
  assert.equal(f.state.musicInfo.id, 'd')
  assert.deepEqual(f.resources, [urlFor('b')])
  assert.equal(f.engine.isGaplessHandoffActive(), true, 'the old completion must not cancel the new handoff')
})

test('queue changes after ended resume selection using the complete edited queue', async t => {
  const f = fixture(t)
  await f.preload()
  const oldValidation = deferred()
  f.hooks.filter = () => oldValidation.promise
  await f.overlap()
  f.end()
  f.store.addTempPlayList([{ musicInfo: song('d'), listId: 'source' }])
  f.hooks.filter = null
  await flush()
  oldValidation.resolve()
  await flush()
  assert.equal(f.state.musicInfo.id, 'd')
  assert(!f.resources.includes(urlFor('b')))
})

test('timed stop arriving during final validation still prevents a track switch', async t => {
  const f = fixture(t)
  await f.preload()
  const validation = deferred()
  f.hooks.filter = () => validation.promise
  await f.overlap()
  await f.commit()
  f.window.lx.isPlayedStop = true
  validation.resolve()
  await flush()
  assert.deepEqual(f.resources, [])
  assert.equal(f.window.lx.isPlayedStop, true)
  assert.equal(f.engine.isGaplessTransitionActive(), false)
  assert.equal(f.secondary.paused, true)
})

for (const result of ['resolve', 'reject']) {
  test(`late audio-play ${result} from a cancelled candidate leaves the replacement intact`, async t => {
    const f = fixture(t)
    await f.preload()
    const oldPlay = deferred()
    f.secondary.pendingPlay = oldPlay.promise
    await f.overlap()
    f.store.removePlayQueue(1)
    f.secondary.pendingPlay = null
    await f.preload()
    await f.overlap()
    oldPlay[result](new Error('cancelled old playback'))
    await flush()
    assert.equal(f.secondary.src, urlFor('c'))
    assert.equal(f.secondary.paused, false)
    await f.commit()
    assert.deepEqual(f.resources, [urlFor('c')])
  })
}

for (const fade of [false, true]) {
  test(`queue deletion cancels audible overlap with fade ${fade}`, async t => {
    const f = fixture(t, { fade })
    await f.preload()
    await f.overlap()
    f.primary.currentTime += 0.02
    await f.advance(40)
    assert(f.secondary.volume > 0)
    f.store.removePlayQueue(1)
    assert.equal(f.secondary.paused, true)
    assert.equal(f.secondary.src, '')
    assert.equal(f.primary.volume, 1)
    assert.equal(f.primary.paused, false)
    await f.preload()
    await f.overlap()
    await f.commit()
    assert.deepEqual(f.resources, [urlFor('c')])
  })
}

for (const cancel of ['pause', 'timeout']) {
  test(`${cancel} during final validation cannot be undone by its late result`, async t => {
    const f = fixture(t)
    await f.preload()
    const validation = deferred()
    f.hooks.filter = () => validation.promise
    await f.overlap()
    await f.commit()
    if (cancel === 'pause') f.core.pause()
    else await f.advance(15000)
    validation.resolve()
    await flush()
    assert.deepEqual(f.resources, [])
    assert.equal(f.state.musicInfo.id, 'a')
    assert.equal(f.engine.isGaplessTransitionActive(), false)
    assert.equal(f.secondary.paused, true)
  })
}

test('an unchanged candidate completes primary playback without duplicate handoffs', async t => {
  const f = fixture(t)
  await f.preload()
  await f.overlap()
  await f.commit()
  f.primary.emit('canplay')
  f.primary.emit('canplay')
  f.primary.emit('playing')
  await f.advance(80)
  assert.deepEqual(f.resources, [urlFor('b')])
  assert.deepEqual(f.history, ['a'])
  assert.equal(f.primary.playCalls, 1)
  assert.equal(f.primary.paused, false)
  assert.equal(f.primary.volume, 1)
  assert.equal(f.primary.autoplay, true)
  assert.equal(f.secondary.paused, true)
  assert.equal(f.engine.isGaplessTransitionActive(), false)
})

test('seeking backwards during final validation keeps the current track playing', async t => {
  const f = fixture(t)
  await f.preload()
  const validation = deferred()
  f.hooks.filter = () => validation.promise
  await f.overlap()
  await f.commit()
  f.primary.currentTime = 10
  f.primary.seeking = true
  f.primary.emit('seeking')
  validation.resolve()
  await flush()
  assert.deepEqual(f.resources, [])
  assert.equal(f.state.musicInfo.id, 'a')
  assert.equal(f.primary.volume, 1)
  assert.equal(f.secondary.paused, true)
  f.hooks.filter = null
  f.primary.seeking = false
  f.primary.emit('seeked')
  await f.overlap()
  await f.commit()
  assert.deepEqual(f.resources, [urlFor('b')])
})
