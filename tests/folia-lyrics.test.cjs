const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { buildTimeline } = load('src/optional-plugins/folia-lyrics/timeline.ts')
const { createStageStateSender } = load('src/optional-plugins/folia-lyrics/stateSync.ts')

test('LX word timestamps retain their offset and duration in Folia seconds', () => {
  const [line] = buildTimeline([{ time: 4200, text: '<0,300>晚<350,700>风', extendedLyrics: ['Evening breeze', 'wan feng'] }], 30)
  assert.deepEqual(line.words, [
    { text: '晚', startTime: 4.2, endTime: 4.5 },
    { text: '风', startTime: 4.55, endTime: 5.25 },
  ])
  assert.equal(line.fullText, '晚风')
  assert.equal(line.endTime, 5.25)
  assert.equal(line.translation, 'Evening breeze\nwan feng')
})
test('plain LRC uses line boundaries and the track duration without fabricating word timing', () => {
  const lines = buildTimeline([{ time: 1000, text: 'first line', extendedLyrics: [] }, { time: 6000, text: 'last line', extendedLyrics: [] }], 12)
  assert.deepEqual(lines.map(line => [line.startTime, line.endTime, line.words.length]), [[1, 6, 1], [6, 12, 1]])
})
test('timelines clear on an empty track and ignore malformed timestamps', () => {
  assert.deepEqual(buildTimeline([], 0), [])
  assert.deepEqual(buildTimeline([{ time: NaN, text: 'bad' }, { time: -10, text: 'bad' }], 0), [])
  const [line] = buildTimeline([{ time: 5000, text: 'short track', extendedLyrics: [] }], 0)
  assert.ok(line.endTime > line.startTime)
})

test('layout and configuration updates do not rebuild or resend an unchanged song', () => {
  const messages = []
  const sender = createStageStateSender((type, data) => messages.push({ type, data }))
  const inputs = [{}, 'song', 'lyrics', 120]
  const config = { mode: 'classic', language: 'zh-cn', fontFamily: '', fontScale: 1, reducedMotion: false, bottomInset: 80 }
  let builds = 0
  const buildSong = () => { builds++; return { id: 'song', lines: [{ fullText: 'lyrics' }] } }
  sender.sync(inputs, buildSong, config)
  for (let i = 0; i < 20; i++) sender.sync([...inputs], buildSong, { ...config })
  assert.equal(builds, 1)
  assert.deepEqual(messages.map(message => message.type), ['state'])
  for (const update of [
    { bottomInset: 100 }, { mode: 'sonnet' }, { fontFamily: 'serif' },
    { fontScale: 1.5 }, { language: 'en-us' }, { reducedMotion: true },
  ]) {
    sender.sync(inputs, buildSong, { ...config, ...update })
    assert.deepEqual(messages.at(-1), { type: 'config', data: { ...config, ...update } })
  }
  assert.equal(builds, 1)
})

test('new lyrics, song metadata and a reloaded frame always receive a complete state', () => {
  const messages = []
  const sender = createStageStateSender((type, data) => messages.push({ type, data }))
  const config = { mode: 'fume', language: 'zh-cn', fontFamily: '', fontScale: 1, reducedMotion: false, bottomInset: 0 }
  let song = { id: 'song', lines: [{ fullText: 'first' }] }
  const build = () => song
  sender.sync([song.lines, song.id], build, config)
  song = { ...song, lines: [{ fullText: 'translated lyrics' }] }
  sender.sync([song.lines, song.id], build, config)
  assert.equal(messages.at(-1).data.song, song)
  song = { id: 'instrumental', lines: [] }
  sender.sync([song.lines, song.id], build, config)
  assert.deepEqual(messages.at(-1).data.song.lines, [])
  sender.reset()
  sender.sync([song.lines, song.id], build, config)
  assert.deepEqual(messages.map(message => message.type), ['state', 'state', 'state', 'state'])
})
