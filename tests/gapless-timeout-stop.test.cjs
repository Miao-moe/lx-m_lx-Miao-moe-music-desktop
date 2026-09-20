const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const gaplessCode = compile('src/renderer/utils/gaplessPlayer.ts')
const timeoutCode = compile('src/renderer/core/player/timeoutStop.ts')
const nextUrl = 'https://example.test/next.mp3'

function fixture(t, fade, waitPlayEndStop = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
  const audios = []
  class Audio extends EventTarget {
    constructor() {
      super()
      this.src = ''
      this.volume = 1
      this.paused = true
      this.ended = false
      this.seeking = false
      this.readyState = 4
      this.autoplay = false
      this.currentTime = 0
      this.duration = 10
      this.defaultPlaybackRate = 1
      this.playbackRate = 1
      this.preservesPitch = true
      this.playCalls = 0
      audios.push(this)
    }

    play() {
      this.playCalls++
      this.paused = false
      return this.pendingPlay ?? Promise.resolve()
    }

    pause() { this.paused = true }
    load() {}
    removeAttribute(name) { if (name === 'src') this.src = '' }
    emit(name) { this.dispatchEvent(new Event(name)) }
  }
  const appSetting = {
    'player.gaplessPlayback': true,
    'player.fadeInFadeOut': fade,
    'player.fadeDuration': 800,
    'player.volume': 0.7,
    'player.maxVolume': 1,
    'player.isMute': false,
    'player.waitPlayEndStop': waitPlayEndStop,
  }
  const window = { lx: { isPlayedStop: false }, setTimeout, clearTimeout, setInterval, clearInterval }
  const load = (code, dependencies) => {
    const exports = {}
    vm.runInNewContext(code, {
      exports,
      window,
      Audio,
      Date,
      setTimeout,
      clearTimeout,
      performance: { now: () => Date.now() },
      console: { log() {}, warn() {} },
      require: name => {
        assert(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`)
        return dependencies[name]
      },
    })
    return exports
  }
  const engine = load(gaplessCode, { '@renderer/store/setting': { appSetting } })
  const primary = new Audio()
  primary.src = 'https://example.test/current.mp3'
  primary.currentTime = 9.95
  primary.paused = false
  primary.autoplay = true
  const transitions = []
  engine.initGaplessEngine(primary, url => {
    transitions.push(url)
    // The normal track switch clears this flag, so a stopped transition must never reach it.
    window.lx.isPlayedStop = false
    primary.src = url
    primary.currentTime = 0
    primary.paused = true
    return true
  })
  const timer = load(timeoutCode, {
    '@common/utils/vueTools': { ref: value => ({ value }), computed: get => ({ get value() { return get() } }) },
    '@renderer/store/player/state': { isPlay: { get value() { return !primary.paused } } },
    '@renderer/store/setting': { appSetting },
    './action': { pause() { engine.cancelGaplessTransition(); primary.pause() } },
  })
  t.after(() => { timer.stopTimeoutStop(); engine.destroyGaplessEngine() })
  return {
    engine,
    timer,
    primary,
    secondary: audios[1],
    transitions,
    window,
    async advance(ms) { t.mock.timers.tick(ms); await new Promise(setImmediate) },
  }
}

function assertStopped(f, primaryPaused = false) {
  assert.equal(f.window.lx.isPlayedStop, true, 'the timer stop flag must remain set')
  assert.deepEqual(f.transitions, [], 'the next track must not be selected')
  assert.equal(f.secondary.paused, true, 'the next track must not keep playing')
  assert.equal(f.secondary.volume, 0)
  assert.equal(f.primary.volume, 1, 'restore the current track volume')
  assert.equal(f.primary.paused, primaryPaused)
  assert.equal(f.engine.isGaplessTransitionActive(), false)
}

for (const fade of [false, true]) {
  const mode = fade ? 'crossfade' : 'gapless'

  test(`${mode}: an expired timer blocks a newly preloaded track`, async t => {
    const f = fixture(t, fade)
    f.timer.startTimeoutStop(0.1)
    await f.advance(100)
    f.engine.setNextSongUrl(nextUrl)
    await f.advance(2000)
    assertStopped(f)
    assert.equal(f.secondary.playCalls, 0)
  })

  test(`${mode}: a scheduled transition checks the timer before starting playback`, async t => {
    const f = fixture(t, fade)
    f.primary.currentTime = 8
    f.timer.startTimeoutStop(1)
    f.engine.setNextSongUrl(nextUrl)
    await f.advance(1000)
    await f.advance(1000)
    assertStopped(f)
    assert.equal(f.secondary.playCalls, 0)
  })

  test(`${mode}: a timer expiring while audio is loading keeps the next track silent`, async t => {
    const f = fixture(t, fade)
    let resolvePlay
    f.secondary.pendingPlay = new Promise(resolve => { resolvePlay = resolve })
    f.timer.startTimeoutStop(0.1)
    f.engine.setNextSongUrl(nextUrl)
    await f.advance(0)
    assert.equal(f.secondary.playCalls, 1)
    await f.advance(100)
    resolvePlay()
    await f.advance(0)
    assertStopped(f)
    assert.equal(f.secondary.src, '')
  })

  for (const trigger of ['timer', 'ended', 'pause']) {
    test(`${mode}: timer expiry during overlap prevents the ${trigger} handoff`, async t => {
      const f = fixture(t, fade)
      f.timer.startTimeoutStop(0.04)
      f.engine.setNextSongUrl(nextUrl)
      await f.advance(0)
      assert.equal(f.engine.isGaplessTransitionActive(), true)
      await f.advance(40)
      if (trigger !== 'timer') {
        f.primary.ended = true
        f.primary.paused = true
        f.primary.emit(trigger)
      }
      await f.advance(1000)
      assertStopped(f, trigger !== 'timer')
      assert.equal(f.secondary.src, '')
      f.primary.emit('timeupdate')
      await f.advance(20000)
      assertStopped(f, trigger !== 'timer')
    })
  }

  test(`${mode}: immediate timer stop cancels overlap and pauses both tracks`, async t => {
    const f = fixture(t, fade, false)
    f.timer.startTimeoutStop(0.04)
    f.engine.setNextSongUrl(nextUrl)
    await f.advance(0)
    await f.advance(40)
    await f.advance(1000)
    assertStopped(f, true)
  })

  test(`${mode}: cancelling a timed stop permits a normal handoff`, async t => {
    const f = fixture(t, fade)
    f.timer.startTimeoutStop(0.1)
    await f.advance(100)
    f.timer.stopTimeoutStop()
    f.engine.setNextSongUrl(nextUrl)
    await f.advance(0)
    f.primary.currentTime = f.primary.duration
    await f.advance(1000)
    assert.deepEqual(f.transitions, [nextUrl])
    assert.equal(f.engine.isGaplessHandoffActive(), true)
    f.primary.emit('canplay')
    await f.advance(0)
    assert.equal(f.primary.playCalls, 1)
    f.primary.emit('playing')
    await f.advance(80)
    assert.equal(f.engine.isGaplessTransitionActive(), false)
    assert.equal(f.primary.volume, 1)
    assert.equal(f.primary.autoplay, true)
    assert.equal(f.primary.paused, false)
    assert.equal(f.secondary.paused, true)
    assert.equal(f.secondary.src, '')
    assert.equal(f.window.lx.isPlayedStop, false)
  })
}
