const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const vue = require('vue')
const load = require('./helpers/load-typescript.cjs')

async function fixture(t, report) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-plugin-runtime-'))
  const previous = { window: global.window, document: global.document, require: global.__non_webpack_require__ }
  const styles = new Set(), events = [], counter = vue.ref(0)
  global.window = {}
  global.document = {
    head: { appendChild: element => styles.add(element) },
    createElement: () => ({ dataset: {}, remove() { styles.delete(this) } }),
  }
  global.__non_webpack_require__ = createRequire(path.join(root, 'host.js'))
  const { createPluginRuntime } = load({ vue, './builtinPlugins': { isBuiltinPlugin: () => false } })('src/common/optionalPluginRuntime.ts')
  const runtime = createPluginRuntime({ events, counter }, false, report)
  const plugin = async(id, version, body, helpers = {}) => {
    const directory = path.join(root, id + '-' + version)
    await fs.mkdir(directory)
    const files = { 'renderer.js': body, 'renderer.css': '.' + id + '{}', ...helpers }
    for (const [name, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
      await fs.writeFile(path.join(directory, name), content)
    }
    return { directory, enabled: true, manifest: { id, version, entry: 'renderer.js', styles: ['renderer.css'] } }
  }
  const snapshot = (revision, installed) => ({ revision, installed, catalog: [], errors: {}, catalogError: null })
  t.after(async() => {
    await runtime.dispose()
    global.window = previous.window; global.document = previous.document; global.__non_webpack_require__ = previous.require
    const target = await fs.realpath(root)
    assert.equal(path.dirname(target).toLowerCase(), (await fs.realpath(os.tmpdir())).toLowerCase())
    assert(path.basename(target).startsWith('lx-plugin-runtime-'))
    await fs.rm(target, { recursive: true, force: true })
  })
  return { root, runtime, styles, events, counter, plugin, snapshot }
}
const moduleText = (id, fail = '') => `const h=window.__lxPluginHost; module.exports.default={components:{Settings:{}}, activate(){
  h.events.push('${id}:load'); h.vue.watch(h.counter,()=>h.events.push('${id}:watch'),{flush:'sync'});
  return async()=>{h.events.push('${id}:unload'); ${fail}}
}}`

test('G04: rejected teardown does not interrupt sync, later cleanup, styles or effect disposal', async t => {
  const f = await fixture(t)
  const a = await f.plugin('broken', '1', moduleText('broken', "throw Error('teardown rejected')"))
  const b = await f.plugin('working', '1', moduleText('working'))
  await f.runtime.sync(f.snapshot(1, { broken: a, working: b }))
  f.counter.value++
  await f.runtime.sync(f.snapshot(2, {}))
  const before = [...f.events]; f.counter.value++
  assert.deepEqual(f.events, before)
  assert(f.events.includes('working:unload'))
  assert.equal(f.styles.size, 0)
  assert.deepEqual(Object.keys(f.runtime.components), [])
  assert.match(f.runtime.cleanupErrors.broken, /teardown rejected/)
  await f.runtime.sync(f.snapshot(3, { broken: a, working: b }))
  await f.runtime.dispose()
  assert.equal(f.events.filter(event => event === 'working:unload').length, 2)
})

test('G05: unloading clears nested and lazy plugin modules while preserving external shared modules', async t => {
  const f = await fixture(t)
  const shared = path.join(f.root, 'shared.js')
  await fs.writeFile(shared, 'module.exports={shared:true}')
  const module = `const helper=require('./helpers/value.js'); const shared=require('../shared.js');
module.exports.default={components:{},activate(){window.__lxPluginHost.events.push(helper);require('./lazy.json');return()=>{}}}`
  const a = await f.plugin('cache', '1', module, { 'helpers/value.js': "module.exports='first'", 'lazy.json': '{"lazy":true}' })
  await f.runtime.sync(f.snapshot(1, { cache: a }))
  const requirePlugin = global.__non_webpack_require__, sharedModule = requirePlugin.cache[shared]
  const parent = requirePlugin.cache[path.join(a.directory, 'renderer.js')].parent
  await f.runtime.unload('cache')
  assert(!Object.keys(requirePlugin.cache).some(filename => filename.startsWith(a.directory + path.sep)))
  assert.equal(requirePlugin.cache[shared], sharedModule)
  assert(!parent.children.some(child => child.filename.startsWith(a.directory + path.sep)))
  assert(!Object.values(requirePlugin.cache).some(module => module?.children.some(child => child.filename.startsWith(a.directory + path.sep))))
  await fs.writeFile(path.join(a.directory, 'helpers/value.js'), "module.exports='second'")
  await f.runtime.sync(f.snapshot(2, { cache: a }))
  assert.deepEqual(f.events, ['first', 'second'])
  delete requirePlugin.cache[shared]
})

test('G03/G05: a failed activation clears cached dependencies without reloading the old version', async t => {
  let fallback, current
  const reports = []
  const f = await fixture(t, async(id, directory, error) => {
    reports.push({ directory, error })
    return current
  })
  fallback = await f.plugin('feature', '1', moduleText('old'))
  const bad = await f.plugin('feature', '2', "require('./dep.js'); module.exports.default={components:{},async activate(){throw Error('activation failed')}}", { 'dep.js': 'module.exports={}' })
  current = f.snapshot(1, { feature: fallback }); await f.runtime.sync(current)
  current = f.snapshot(2, { feature: bad }); await f.runtime.sync(current)
  assert.deepEqual(f.events, ['old:load', 'old:unload'])
  assert.match(f.runtime.errors.feature, /activation failed/)
  assert.equal(f.styles.size, 0)
  assert(!Object.keys(global.__non_webpack_require__.cache).some(filename => filename.startsWith(bad.directory + path.sep)))
  assert.equal(reports.filter(result => result.error).length, 1)
})

test('G03/G06: repeated snapshots do not loop on a broken plugin; disable and enable allow a new attempt', async t => {
  const f = await fixture(t)
  const bad = await f.plugin('broken', '1', "window.__lxPluginHost.events.push('attempt'); throw Error('entry failed')")
  await f.runtime.sync(f.snapshot(1, { broken: bad }))
  await f.runtime.sync(f.snapshot(2, { broken: bad }))
  assert.deepEqual(f.events, ['attempt'])
  await f.runtime.sync(f.snapshot(3, { broken: { ...bad, enabled: false } }))
  assert.equal(f.runtime.errors.broken, undefined)
  await f.runtime.sync(f.snapshot(4, { broken: bad }))
  assert.deepEqual(f.events, ['attempt', 'attempt'])
})

test('G06: disabled plugins execute no code, and enabling then disabling removes all contributions', async t => {
  const f = await fixture(t)
  const a = await f.plugin('feature', '1', moduleText('feature'))
  await f.runtime.sync(f.snapshot(1, { feature: { ...a, enabled: false } }))
  assert.deepEqual(f.events, []); assert.equal(f.styles.size, 0)
  await f.runtime.sync(f.snapshot(2, { feature: a }))
  assert(f.runtime.components.feature)
  await f.runtime.sync(f.snapshot(3, { feature: { ...a, enabled: false } }))
  assert.deepEqual(f.events, ['feature:load', 'feature:unload'])
  assert.equal(f.styles.size, 0)
  assert.equal(f.runtime.components.feature, undefined)
})
