const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const code = fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/player/volume-normalizer.worklet.js'), 'utf8')

function createProcessor(sampleRate = 48000) {
  let Processor
  class Base { constructor() { this.port = { postMessage: state => { this.lastState = state } } } }
  vm.runInNewContext(code, { AudioWorkletProcessor: Base, sampleRate, registerProcessor: (_name, value) => { Processor = value } })
  return new Processor()
}
function render(processor, amplitude, seconds, { enabled = true, rate = 48000, channels = [1, 1], frames = 128 } = {}) {
  let energy = 0, count = 0, peak = 0, balanceError = 0
  const length = Math.ceil(seconds * rate)
  for (let position = 0; position < length; position += frames) {
    const block = Math.min(frames, length - position)
    const inputs = channels.map(scale => Float32Array.from({ length: block }, (_, i) => {
      const level = typeof amplitude === 'function' ? amplitude(position + i) : amplitude
      return level * scale * Math.sin((position + i) * Math.PI * 2 * 997 / rate)
    }))
    const outputs = channels.map(() => new Float32Array(block))
    processor.process([inputs], [outputs], { enabled: new Float32Array([enabled ? 1 : 0]) })
    for (let i = 0; i < block; i++) {
      for (const output of outputs) {
        assert.ok(Number.isFinite(output[i]), 'output must remain finite')
        peak = Math.max(peak, Math.abs(output[i]))
        if (position > length / 2) { energy += output[i] ** 2; count++ }
      }
      if (channels.length === 2) balanceError = Math.max(balanceError, Math.abs(outputs[1][i] - outputs[0][i] * channels[1] / channels[0]))
    }
  }
  return { rms: Math.sqrt(energy / count), peak, balanceError }
}

for (const rate of [44100, 48000]) {
  test(`matches the level of tracks with an 18 dB input difference at ${rate} Hz`, () => {
    const quiet = render(createProcessor(rate), 0.1, 8, { rate })
    const loud = render(createProcessor(rate), 0.8, 8, { rate })
    const difference = Math.abs(20 * Math.log10(loud.rms / quiet.rms))
    assert.ok(difference < 0.4, `remaining difference: ${difference.toFixed(3)} dB`)
    assert.ok(Math.abs(20 * Math.log10(loud.rms) + 18) < 0.2)
  })
}

test('silence and a very quiet passage do not drive the gain upwards', () => {
  const processor = createProcessor()
  assert.equal(render(processor, 0, 5).peak, 0)
  assert.equal(processor.gainDb, 0)
  render(processor, 0.5, 4)
  const gainBefore = processor.gainDb
  const energyBefore = processor.energy
  render(processor, 0, 5)
  render(processor, 0.0001, 5)
  assert.equal(processor.energy, energyBefore)
  assert.ok(processor.gainDb <= gainBefore + 0.05)
})

test('boost is bounded and lookahead handles sudden peaks without clipping or changing stereo balance', () => {
  const processor = createProcessor()
  render(processor, 0.01, 8, { channels: [1, 0.5] })
  assert.ok(processor.gainDb <= 6 && processor.gainDb > 5.8)
  const result = render(processor, frame => frame < 24000 ? 0.01 : 0.99, 1, { channels: [1, 0.5], frames: 37 })
  assert.ok(result.peak <= 0.98001, `peak ${result.peak}`)
  assert.ok(result.balanceError < 0.000001)
})

test('disabling smoothly returns to the original level and stops peak limiting', () => {
  const processor = createProcessor()
  render(processor, 0.1, 6)
  const result = render(processor, 0.7, 2, { enabled: false })
  assert.ok(Math.abs(result.rms - 0.7 / Math.sqrt(2)) < 0.001)
  const hot = render(processor, 1.1, 1, { enabled: false })
  assert.ok(hot.peak > 1.09, 'disabled normalization must not keep a limiter enabled')
})

test('track reset forgets the previous level, while a gapless handoff reuses the incoming track estimate', () => {
  const incoming = createProcessor()
  render(incoming, 0.7, 4)
  const current = createProcessor()
  render(current, 0.1, 4)
  current.port.onmessage({ data: { type: 'reset', generation: 2, state: incoming.lastState } })
  const handoff = render(current, 0.7, 0.2)
  assert.ok(Math.abs(20 * Math.log10(handoff.rms) + 18) < 0.3)
  assert.equal(current.lastState.generation, 2)
  current.port.onmessage({ data: { type: 'reset', generation: 3 } })
  assert.equal(current.energy, 0)
  assert.equal(current.gainDb, 0)
  assert.equal(current.activeTime, 0)
  current.port.onmessage({ data: { type: 'dispose' } })
  assert.equal(current.process([], [], {}), false)
})
