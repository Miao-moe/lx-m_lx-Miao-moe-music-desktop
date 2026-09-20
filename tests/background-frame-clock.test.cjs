const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createFrameClock } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/kawarpBackground/frameClock.ts')

test('background pacing retains its target on both slow and high-refresh displays', () => {
  for (const target of [20, 30]) {
    for (const refresh of [30, 60, 90, 120, 144, 165, 240, 300]) {
      const clock = createFrameClock()
      const frames = []
      for (let index = 0; index <= refresh * 10; index++) {
        const now = index * 1000 / refresh
        const elapsed = clock.advance(now, 1000 / target)
        if (elapsed != null) frames.push({ now, elapsed })
      }
      assert(Math.abs(frames.length - (target * 10 + 1)) <= 1, `${target}fps on ${refresh}Hz: ${frames.length} draws`)
      const duration = frames.reduce((sum, frame) => sum + frame.elapsed, 0)
      assert(Math.abs(duration - 1 / target - frames.at(-1).now / 1000) < 1e-9, 'movement follows elapsed time, not draw count')
    }
  }
})

test('late frames skip missed draws without a catch-up burst or a large clock jump', () => {
  const clock = createFrameClock()
  assert.equal(clock.advance(0, 50), 0.05)
  assert.equal(clock.advance(33.333, 50), null)
  assert(clock.advance(66.667, 50) > 0)
  assert(clock.advance(100, 50) > 0, 'a delayed frame must not shift all later deadlines')
  assert.equal(clock.advance(15000, 50), 0.1)
  for (const now of [15000, 15001, 15020, 15049]) assert.equal(clock.advance(now, 50), null)
  assert.equal(clock.advance(15050, 50), 0.05)
})

test('a hidden-window resume and quality changes start a fresh deadline', () => {
  const clock = createFrameClock()
  clock.advance(100, 50)
  clock.reset()
  assert.equal(clock.advance(20000, 50), 0.05)
  assert.equal(clock.advance(20010, 50), null)
  assert.equal(clock.advance(20010, 1000 / 30), 1 / 30, 'quality changes reset the old cadence')
})
