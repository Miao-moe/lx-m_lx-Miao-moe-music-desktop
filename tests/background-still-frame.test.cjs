const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { test } = require('node:test')

const source = ts.transpileModule(fs.readFileSync('src/renderer/utils/kawarpBackground/stillFrame.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const harness = () => {
  const encoded = []; const decoded = []; const published = []; const revoked = []
  let serial = 0
  const context = {
    exports: {},
    URL: { createObjectURL: () => 'blob:' + ++serial, revokeObjectURL: value => revoked.push(value) },
    Image: class { decode() { return new Promise((resolve, reject) => decoded.push({ resolve, reject })) } },
  }
  vm.runInNewContext(source, context)
  const still = context.exports.createStillFrame(value => published.push(value))
  const canvas = { toBlob(resolve, format) { assert.equal(format, 'image/png'); encoded.push(resolve) } }
  return { still, canvas, encoded, decoded, published, revoked }
}

test('static presentation is published only after lossless image decoding, and released on resume', async() => {
  const h = harness()
  const pending = h.still.capture(h.canvas)
  assert.deepEqual(h.published, [])
  h.encoded.shift()({})
  await Promise.resolve()
  assert.deepEqual(h.published, [])
  h.decoded.shift().resolve()
  await pending
  assert.deepEqual(h.published, ['blob:1'])
  h.still.clear()
  h.still.clear()
  assert.deepEqual(h.published, ['blob:1', ''])
  assert.deepEqual(h.revoked, ['blob:1'])
})

test('a cover or size change discards a slow previous capture', async() => {
  const h = harness()
  const first = h.still.capture(h.canvas)
  h.still.clear()
  const second = h.still.capture(h.canvas)
  h.encoded[1]({})
  await Promise.resolve()
  h.decoded.shift().resolve()
  await second
  h.encoded[0]({})
  await first
  assert.deepEqual(h.published, ['blob:1'])
  h.still.dispose()
  assert.deepEqual(h.revoked, ['blob:1'])
})

test('resume or unmount during decode never publishes a stale image or leaks its URL', async() => {
  for (const action of ['clear', 'dispose']) {
    const h = harness()
    const pending = h.still.capture(h.canvas)
    h.encoded.shift()({})
    await Promise.resolve()
    h.still[action]()
    h.decoded.shift().resolve()
    await pending
    assert.deepEqual(h.published, [])
    assert.deepEqual(h.revoked, ['blob:1'])
    if (action === 'dispose') {
      await h.still.capture(h.canvas)
      assert.equal(h.encoded.length, 0)
    }
  }
})

test('encoding and decoding failures leave the live background available', async() => {
  const h = harness()
  const absent = h.still.capture(h.canvas)
  h.encoded.shift()(null)
  await absent
  await h.still.capture({ toBlob() { throw new Error('Context lost') } })
  const failed = h.still.capture(h.canvas)
  h.encoded.shift()({})
  await Promise.resolve()
  h.decoded.shift().reject(new Error('Decode failed'))
  await failed
  assert.deepEqual(h.published, [])
  assert.deepEqual(h.revoked, ['blob:1'])
})
