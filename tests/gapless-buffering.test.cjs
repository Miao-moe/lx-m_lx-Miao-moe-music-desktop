const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/utils/gaplessPlayer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const nextUrl = 'https://example.test/next.mp3'
const flush = async() => new Promise(setImmediate)

function fixture(t, fade, nearEnd = false, output) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  const audios = []
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
        duration: 60,
        currentTime: 0,
        defaultPlaybackRate: 1,
        playbackRate: 1,
        preservesPitch: true,
        playCalls: 0,
      })
      audios.push(this)
    }

    play() { this.playCalls++; this.paused = false; return this.pendingPlay ?? Promise.resolve() }
    pause() { this.paused = true }
    load() {}
    removeAttribute(name) { if (name === 'src') this.src = '' }
    emit(name) { this.dispatchEvent(new Event(name)) }
  }
  const primary = new Audio()
  Object.assign(primary, { src: 'current.mp3', paused: false, autoplay: true, currentTime: nearEnd ? (fade ? 59.3 : 59.95) : 40 })
  const transitions = []
  const window = { lx: { isPlayedStop: false }, app_event: { playerEnded() {} }, setTimeout, clearTimeout }
  const session = require('./helpers/playback-session.cjs')(window)
  const engine = {}
  vm.runInNewContext(code, {
    exports: engine,
    window,
    Audio,
    Date,
    console: { warn() {} },
    require(name) {
      if (name.endsWith('playbackSession')) return session
      assert.equal(name, '@renderer/store/setting')
      return {
        appSetting: {
          'player.gaplessPlayback': true,
          'player.fadeInFadeOut': fade,
          'player.fadeDuration': 800,
          'player.volume': 0.7,
          'player.maxVolume': 1,
          'player.isMute': false,
        },
      }
    },
  })
  engine.initGaplessEngine(primary, url => {
    transitions.push(url)
    Object.assign(primary, { src: url, currentTime: 0, paused: true, ended: false })
    return true
  }, output)
  t.after(() => engine.destroyGaplessEngine())
  return {
    engine,
    primary,
    secondary: audios[1],
    transitions,
    window,
    async advance(ms) { t.mock.timers.tick(ms); await flush() },
    async start() { engine.setNextSongUrl(nextUrl); t.mock.timers.tick(0); await flush() },
    async finish() { primary.currentTime = primary.duration; t.mock.timers.tick(20); await flush() },
  }
}

test('a normalized crossfade changes only the output envelopes through the complete handoff', async t => {
  const levels = new Map()
  const output = {
    attach(audio) { audio.volume = 1; levels.set(audio, 0); return () => levels.delete(audio) },
    getVolume(audio) { return levels.get(audio) ?? 1 },
    setVolume(audio, volume) { levels.set(audio, volume) },
    getTargetVolume() { return 1 },
  }
  const f = fixture(t, true, true, output)
  await f.start()
  f.primary.currentTime = 59.65
  await f.advance(20)
  assert.ok(Math.abs(levels.get(f.primary) - 0.5) < 0.001)
  assert.ok(Math.abs(levels.get(f.secondary) - 0.5) < 0.001)
  assert.equal(f.primary.volume, 1, 'the normalizer must continue measuring the unattenuated primary source')
  assert.equal(f.secondary.volume, 1, 'the incoming source must not be measured after its fade')
  await f.finish()
  f.primary.emit('canplay')
  await f.advance(0)
  f.primary.emit('playing')
  await f.advance(80)
  assert.equal(levels.get(f.primary), 1)
  assert.equal(levels.get(f.secondary), 0)
  assert.equal(f.engine.isGaplessTransitionActive(), false)
  assert.deepEqual(f.transitions, [nextUrl])
})

for (const fade of [false, true]) {
  const mode = fade ? 'crossfade' : 'gapless'

  test(`${mode}: an elapsed prediction cannot start the next track while media time is frozen`, async t => {
    const f = fixture(t, fade)
    await f.start()
    await f.advance(30000)
    assert.equal(f.secondary.playCalls, 0)
    assert.deepEqual(f.transitions, [])
    assert.equal(f.primary.volume, 1)
    f.primary.currentTime = fade ? 59.3 : 59.95
    f.primary.emit('playing')
    await f.advance(0)
    assert.equal(f.secondary.playCalls, 1)
    await f.finish()
    assert.deepEqual(f.transitions, [nextUrl])
  })

  for (const event of ['waiting', 'stalled']) {
    test(`${mode}: ${event} cancels the prediction and playing schedules from the actual position`, async t => {
      const f = fixture(t, fade)
      await f.start()
      f.primary.readyState = 2
      f.primary.emit(event)
      await f.advance(60000)
      assert.equal(f.secondary.playCalls, 0)
      f.primary.readyState = 4
      f.primary.emit('canplay')
      await f.advance(10000)
      assert.equal(f.secondary.playCalls, 0, 'readiness alone does not prove playback resumed')
      f.primary.currentTime = fade ? 59.3 : 59.95
      f.primary.emit('playing')
      await f.advance(0)
      await f.finish()
      assert.deepEqual(f.transitions, [nextUrl])
    })

    test(`${mode}: ${event} during overlap restores the current track and preserves the candidate`, async t => {
      const f = fixture(t, fade, true)
      await f.start()
      f.primary.currentTime += fade ? 0.2 : 0.02
      await f.advance(20)
      assert(f.secondary.volume > 0)
      f.primary.readyState = 2
      f.primary.emit(event)
      assert.equal(f.secondary.paused, true)
      assert.equal(f.primary.volume, 1)
      assert.equal(f.primary.paused, false)
      assert.equal(f.engine.isGaplessTransitionActive(), false)
      await f.advance(60000)
      assert.deepEqual(f.transitions, [])
      f.primary.readyState = 4
      f.primary.emit('playing')
      await f.advance(0)
      assert.equal(f.secondary.src, nextUrl)
      await f.finish()
      assert.deepEqual(f.transitions, [nextUrl])
    })
  }

  test(`${mode}: insufficient buffered data blocks playback even without a waiting event`, async t => {
    const f = fixture(t, fade, true)
    f.primary.readyState = 2
    await f.start()
    await f.advance(20000)
    assert.equal(f.secondary.playCalls, 0)
    assert.deepEqual(f.transitions, [])
  })

  test(`${mode}: frozen media time during overlap cannot finish the fade or select the next track`, async t => {
    const f = fixture(t, fade, true)
    await f.start()
    await f.advance(2000)
    assert.deepEqual(f.transitions, [])
    assert.equal(f.secondary.paused, true)
    assert.equal(f.primary.volume, 1)
    f.primary.currentTime += 0.01
    f.primary.emit('timeupdate')
    await f.advance(0)
    await f.finish()
    assert.deepEqual(f.transitions, [nextUrl])
  })

  test(`${mode}: waiting while secondary play is pending invalidates its late result`, async t => {
    const f = fixture(t, fade, true)
    let resolvePlay
    f.secondary.pendingPlay = new Promise(resolve => { resolvePlay = resolve })
    await f.start()
    f.primary.readyState = 2
    f.primary.emit('waiting')
    resolvePlay()
    await flush()
    await f.advance(20000)
    assert.deepEqual(f.transitions, [])
    assert.equal(f.secondary.paused, true)
    assert.equal(f.primary.volume, 1)
  })

  test(`${mode}: seeking backwards cancels overlap and waits for the new position`, async t => {
    const f = fixture(t, fade, true)
    await f.start()
    f.primary.currentTime = 20
    f.primary.seeking = true
    f.primary.emit('seeking')
    await f.advance(50000)
    assert.deepEqual(f.transitions, [])
    assert.equal(f.secondary.paused, true)
    f.primary.seeking = false
    f.primary.emit('seeked')
    await f.advance(50000)
    assert.deepEqual(f.transitions, [])
    f.primary.currentTime = fade ? 59.3 : 59.95
    f.primary.emit('playing')
    await f.advance(0)
    await f.finish()
    assert.deepEqual(f.transitions, [nextUrl])
  })

  test(`${mode}: losing duration during buffering suspends overlap until it is known again`, async t => {
    const f = fixture(t, fade, true)
    await f.start()
    f.primary.duration = NaN
    f.primary.emit('durationchange')
    await f.advance(20)
    assert.deepEqual(f.transitions, [])
    assert.equal(f.primary.volume, 1)
    assert.equal(f.secondary.paused, true)
    f.primary.duration = 60
    f.primary.emit('durationchange')
    await f.advance(0)
    await f.finish()
    assert.deepEqual(f.transitions, [nextUrl])
  })
}

for (const rate of [0.5, 1, 2]) {
  test(`800ms crossfade at ${rate}x lasts 800ms of advancing playback`, async t => {
    const f = fixture(t, true)
    f.primary.playbackRate = rate
    f.primary.currentTime = 60 - rate
    await f.start()
    assert.equal(f.secondary.playCalls, 0)
    f.primary.currentTime += 0.201 * rate
    await f.advance(201)
    assert.equal(f.secondary.playCalls, 1)
    f.primary.currentTime += 0.4 * rate
    await f.advance(400)
    assert(f.primary.volume > 0.49 && f.primary.volume < 0.51)
    assert.deepEqual(f.transitions, [], 'twice the rate must not halve the fade')
    f.primary.currentTime = 60
    await f.advance(400)
    assert.deepEqual(f.transitions, [nextUrl])
  })

  test(`crossfade at ${rate}x follows media progress through to the actual end`, async t => {
    const f = fixture(t, true)
    f.primary.playbackRate = rate
    f.primary.currentTime = 60 - 0.7 * rate
    await f.start()
    assert.equal(f.secondary.playCalls, 1)
    f.primary.currentTime += 0.35 * rate
    await f.advance(350)
    assert(f.primary.volume > 0.45 && f.primary.volume < 0.55)
    assert.deepEqual(f.transitions, [])
    await f.finish()
    assert.deepEqual(f.transitions, [nextUrl])
  })
}

test('changing playback rate during overlap also updates the secondary player', async t => {
  const f = fixture(t, true, true)
  await f.start()
  f.primary.defaultPlaybackRate = f.primary.playbackRate = 2
  f.primary.emit('ratechange')
  assert.equal(f.secondary.playbackRate, 2)
  assert.equal(f.secondary.defaultPlaybackRate, 2)
  await f.finish()
  assert.deepEqual(f.transitions, [nextUrl])
})
