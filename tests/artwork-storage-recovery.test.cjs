const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t, synchronousFailure = false) {
  const previous = global.indexedDB
  t.after(() => { global.indexedDB = previous })
  let opens = 0
  const databases = []
  global.indexedDB = {
    open() {
      opens++
      if (opens === 1 && synchronousFailure) throw Error('Storage unavailable')
      const request = {}
      queueMicrotask(() => {
        if (opens === 1) { request.error = Error('Storage unavailable'); request.onerror(); return }
        const database = {
          close() {},
          transaction() {
            return {
              objectStore: () => ({
                get: () => {
                  const read = { result: 'cached artwork' }
                  queueMicrotask(() => read.onsuccess())
                  return read
                },
              }),
            }
          },
        }
        databases.push(database)
        request.result = database
        request.onsuccess()
      })
      return request
    },
  }
  return { storage: loader()('src/renderer/utils/artworkStorage.ts'), opens: () => opens, databases }
}

for (const synchronous of [false, true]) {
  test(`artwork storage retries after a ${synchronous ? 'synchronous' : 'asynchronous'} opening failure`, async t => {
    const f = fixture(t, synchronous)
    const first = await Promise.all([f.storage.readArtworkCache('one'), f.storage.readArtworkCache('two')])
    assert.deepEqual(first, [undefined, undefined])
    assert.equal(f.opens(), 1, 'concurrent readers share the failed attempt')
    assert.equal(await f.storage.readArtworkCache('one'), 'cached artwork')
    assert.equal(f.opens(), 2)
    await f.storage.readArtworkCache('two')
    assert.equal(f.opens(), 2, 'successful connections are reused')
  })
}

test('closed connections reopen and stale close events cannot invalidate the new database', async t => {
  const f = fixture(t)
  await f.storage.readArtworkCache('one')
  await f.storage.readArtworkCache('one')
  const old = f.databases[0]
  old.onversionchange()
  assert.equal(await f.storage.readArtworkCache('one'), 'cached artwork')
  assert.equal(f.opens(), 3)
  old.onclose()
  await f.storage.readArtworkCache('one')
  assert.equal(f.opens(), 3)
  f.databases[1].onclose()
  await f.storage.readArtworkCache('one')
  assert.equal(f.opens(), 4)
})
