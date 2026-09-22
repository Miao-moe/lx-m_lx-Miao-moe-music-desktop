const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-config-save-'))
  const previous = global.lxDataPath; global.lxDataPath = directory
  let count = 0, block, fail = false
  const module = loader({
    electron: { dialog: {}, shell: {} }, '@common/utils': { log: { error() {} } },
    'node:fs/promises': { ...fs, rename: async(from, to) => { count++; if (block) await block.promise; if (fail) throw Object.assign(Error('disk full'), { code: 'ENOSPC' }); return fs.rename(from, to) } },
  })('src/main/utils/store.ts')
  const filename = path.join(directory, 'settings.json'); await fs.writeFile(filename, '{"volume":0.5}')
  const store = module.default('settings')
  t.after(async() => { block?.resolve(); await module.flushStores(); global.lxDataPath = previous; assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-config-save-'))); await fs.rm(directory, { recursive: true, force: true }) })
  return { ...module, store, filename, get count() { return count }, block() { block = gate(); return block }, fail() { fail = true }, recover() { fail = false } }
}
test('D07/D08: bursts coalesce, reads remain committed, and quit flushing waits for disk', async t => {
  const f = await fixture(t), barrier = f.block()
  const tasks = [f.store.set('volume', 0.1), f.store.set('theme', 'dark'), f.store.set('volume', 0.8)]
  await new Promise(setImmediate)
  assert.equal(f.store.get('volume'), 0.5)
  let flushed = false; const flush = f.flushStores().then(() => { flushed = true })
  await new Promise(setImmediate); assert.equal(flushed, false)
  barrier.resolve(); await Promise.all(tasks); await flush
  assert.equal(f.count, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(f.filename, 'utf8')), { volume: 0.8, theme: 'dark' })
  assert.equal(f.store.get('volume'), 0.8)
})
test('D08: a failed batch leaves both memory and disk unchanged; later writes recover', async t => {
  const f = await fixture(t); f.fail()
  await assert.rejects(f.store.set('volume', 0.9), /disk full/)
  assert.equal(f.store.get('volume'), 0.5)
  assert.deepEqual(JSON.parse(await fs.readFile(f.filename, 'utf8')), { volume: 0.5 })
  assert.deepEqual(await fs.readdir(path.dirname(f.filename)), ['settings.json'])
  f.recover(); await f.store.set('theme', 'light')
  assert.deepEqual(f.store.snapshot(), { volume: 0.5, theme: 'light' })
})
test('D08: snapshots and submitted objects cannot mutate the committed store', async t => {
  const f = await fixture(t), value = { nested: { count: 1 } }
  const saved = f.store.set('object', value); value.nested.count = 99; await saved
  f.store.get('object').nested.count = 50
  f.store.snapshot().object.nested.count = 100
  assert.equal(f.store.get('object').nested.count, 1)
  assert.equal(JSON.parse(await fs.readFile(f.filename, 'utf8')).object.nested.count, 1)
})
test('D04/D08: incomplete rollback protects later configuration changes until recovery', async t => {
  const f = await fixture(t)
  f.protectStoreRecovery(Error('backup:rollback_failed'))
  await assert.rejects(f.store.set('volume', 0.2), /rollback_failed/)
  assert.equal(f.store.get('volume'), 0.5)
  f.protectStoreRecovery(null)
  await f.store.set('volume', 0.2)
  assert.equal(f.store.get('volume'), 0.2)
})
test('D08: a later queued mutation is rebased on committed data after failure', async t => {
  const f = await fixture(t), barrier = f.block(); f.fail()
  const first = f.store.set('volume', 0.9); const rejected = assert.rejects(first, /disk full/)
  await new Promise(setImmediate)
  const second = f.store.set('theme', 'dark')
  void first.catch(() => { f.recover() })
  barrier.resolve(); await rejected; await second
  assert.deepEqual(f.store.snapshot(), { volume: 0.5, theme: 'dark' })
})
test('D08: custom source configuration acknowledges persistence before mutating its cache', async t => {
  const f = await fixture(t)
  await f.store.set('userApis', [])
  const apis = loader({ '@main/utils/store': () => f.store, './config': { userApis: [] } })('src/main/modules/userApi/utils.ts')
  const script = '/*\n * @name Test source\n * @version 1.0.0\n */\nconst test = true'
  f.fail(); await assert.rejects(apis.importApi(script), /disk full/)
  assert.deepEqual(apis.getUserApis(), [])
  f.recover(); const info = await apis.importApi(script)
  assert.equal(apis.getUserApis()[0].id, info.id)
  assert.equal(await apis.getScript(info.id), script)
  f.fail(); await assert.rejects(apis.removeApi([info.id]), /disk full/)
  assert.equal(apis.getUserApis().length, 1)
  await assert.rejects(apis.setAllowShowUpdateAlert(info.id, false), /disk full/)
  assert.equal(apis.getUserApis()[0].allowShowUpdateAlert, true)
  f.recover(); await apis.removeApi([info.id])
  assert.deepEqual(apis.getUserApis(), [])
  assert.deepEqual(f.store.get('userApis'), [])
})
