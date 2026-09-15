const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { gzipSync } = require('node:zlib')
const { test } = require('node:test')
const ts = require('typescript')

const project = path.resolve(__dirname, '..')
const modules = new Map()
function loadTs(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = module.paths
  const originalRequire = loaded.require.bind(loaded)
  loaded.require = name => name.startsWith('@common/')
    ? loadTs(path.join(project, 'src/common', name.slice('@common/'.length) + '.ts'))
    : originalRequire(name)
  modules.set(filename, loaded)
  loaded._compile(ts.transpileModule(fsSync.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
  return loaded.exports
}
const { PluginManager, parseCatalog, unpackPlugin } = loadTs(path.join(project, 'src/main/modules/optionalPlugins/manager.ts'))
const { OFFICIAL_PLUGIN_ROOT, pluginText, comparePluginVersions, isPluginId } = loadTs(path.join(project, 'src/common/optionalPlugins.ts'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const bundle = (id, version = '1.0.0', transform = value => value) => {
  const data = Buffer.from('module.exports = { default: { components: {} } }')
  const manifest = { id, version, apiVersion: 1, entry: 'renderer.js', styles: [], files: [{ path: 'renderer.js', bytes: data.length, sha256: hash(data) }] }
  const archive = gzipSync(Buffer.from(JSON.stringify(transform({ manifest, files: { 'renderer.js': data.toString('base64') } }))))
  return { archive, entry: { id, version, apiVersion: 1, path: `${id}/${version}/${hash(archive)}.lxplugin`, bytes: archive.length, sha256: hash(archive) } }
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-plugin-manager-'))
  t.after(async() => {
    assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(), 'lx-plugin-manager-')))
    await fs.rm(root, { recursive: true, force: true })
  })
  const state = { packages: [bundle('sound-effects'), bundle('audio-visualizer')], offline: false, corruptDownload: false }
  const fetchBinary = async url => {
    if (state.offline) throw new Error('Offline')
    if (url === OFFICIAL_PLUGIN_ROOT + 'catalog-v2.json') return Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: state.packages.map(item => item.entry) }))
    const item = state.packages.find(item => url === OFFICIAL_PLUGIN_ROOT + item.entry.path)
    assert.ok(item, url)
    return state.corruptDownload ? Buffer.from('broken') : item.archive
  }
  return { root, state, manager: new PluginManager(root, fetchBinary), restart: () => new PluginManager(root, fetchBinary) }
}

test('the distributable official plugins pass all package checks', async() => {
  const root = path.join(project, 'plugins/official')
  const catalog = parseCatalog(await fs.readFile(path.join(root, 'catalog-v2.json')))
  assert.deepEqual(catalog.plugins.map(entry => entry.id).sort(), ['audio-tag-editor', 'audio-visualizer', 'folia-lyrics', 'sound-effects'])
  const legacy = parseCatalog(await fs.readFile(path.join(root, 'catalog.json')))
  assert.deepEqual(legacy.plugins.map(entry => entry.id), ['sound-effects', 'audio-visualizer'])
  for (const entry of catalog.plugins) {
    const bytes = await fs.readFile(path.join(root, entry.path))
    const result = unpackPlugin(bytes, entry)
    assert.equal(result.manifest.id, entry.id)
    assert.ok(result.files.some(file => file.path === 'renderer.js'))
    if (entry.id === 'sound-effects') assert.ok(result.files.some(file => file.path.startsWith('filters/')))
    else if (entry.id === 'audio-visualizer') {
      assert.ok(result.files.some(file => file.path === 'lyric.js'))
      assert.ok(result.files.some(file => file.path === 'NOTICE.md'))
      assert.ok(result.files.some(file => file.path === 'licenses/audioMotion-AGPL-3.0.txt'))
    } else if (entry.id === 'folia-lyrics') {
      assert.equal(result.manifest.apiVersion, 2)
      for (const name of ['engine/index.html', 'engine/engine.js', 'engine/engine.css', 'source.tar.gz', 'LICENSE', 'NOTICE.md', 'licenses/THIRD-PARTY.txt']) {
        assert.ok(result.files.some(file => file.path === name), name)
      }
      assert.throws(() => unpackPlugin(bytes, { ...entry, apiVersion: 1 }))
    } else if (entry.id === 'audio-tag-editor') {
      assert.equal(result.manifest.apiVersion, 2)
      for (const name of ['renderer.css', 'NOTICE.md', 'licenses/node-id3-MIT.txt', 'licenses/iconv-lite-MIT.txt']) {
        assert.ok(result.files.some(file => file.path === name), name)
      }
    }
  }
})

test('catalog rejects traversal, foreign URLs, duplicate IDs and oversized packages', () => {
  const { entry } = bundle('sound-effects')
  for (const patch of [{ path: '../escape.lxplugin' }, { path: 'https://example.com/a.lxplugin' }, { path: 'sound-effects/1.0.0/a/../b.lxplugin' }, { id: 'unknown' }, { bytes: 30 * 1024 * 1024 }]) {
    assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, ...patch }] }))))
  }
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [entry, entry] }))))
})

test('package checks reject corrupted downloads and unsafe file names before extraction', () => {
  const valid = bundle('sound-effects')
  assert.throws(() => unpackPlugin(Buffer.from('broken'), valid.entry), /checksum/)
  const tampered = Buffer.from(valid.archive)
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => unpackPlugin(tampered, valid.entry), /checksum/)
  for (const filename of ['../escape.js', '/outside.js', 'C:/outside.js', 'folder\\outside.js', 'folder./outside.js', 'NUL.js', 'con/entry.js', 'Manifest.json']) {
    const unsafe = bundle('sound-effects', '1.0.0', archive => {
      archive.manifest.files[0].path = filename
      archive.files[filename] = archive.files['renderer.js']
      delete archive.files['renderer.js']
      return archive
    })
    assert.throws(() => unpackPlugin(unsafe.archive, unsafe.entry), /Invalid plugin file/)
  }
})

test('plugins install independently, survive an offline restart, and uninstall only their own files', async t => {
  const { manager, state, root, restart } = await fixture(t)
  await fs.writeFile(path.join(root, 'preserved-settings.json'), '{"eq":6}')
  await manager.refresh()
  assert.deepEqual(Object.keys((await manager.install('sound-effects')).installed), ['sound-effects'])
  const both = await manager.install('audio-visualizer')
  const soundDirectory = both.installed['sound-effects'].directory
  state.offline = true
  const reopened = restart()
  assert.equal(Object.keys((await reopened.snapshot()).installed).length, 2)
  assert.equal((await reopened.refresh()).catalogError, 'Offline')
  const remaining = await reopened.uninstall('sound-effects')
  assert.deepEqual(Object.keys(remaining.installed), ['audio-visualizer'])
  await assert.rejects(fs.stat(soundDirectory), { code: 'ENOENT' })
  assert.equal(await fs.readFile(path.join(root, 'preserved-settings.json'), 'utf8'), '{"eq":6}')
})

test('a failed update preserves the installed version and corruption can be repaired', async t => {
  const { manager, state } = await fixture(t)
  await manager.refresh()
  const initial = (await manager.install('sound-effects')).installed['sound-effects']
  state.packages[0] = bundle('sound-effects', '1.1.0')
  await manager.refresh()
  state.corruptDownload = true
  await assert.rejects(manager.install('sound-effects'), /checksum/)
  assert.equal((await manager.snapshot()).installed['sound-effects'].directory, initial.directory)
  await fs.writeFile(path.join(initial.directory, 'renderer.js'), 'corrupt')
  const broken = await manager.snapshot()
  assert.equal(broken.installed['sound-effects'], undefined)
  assert.match(broken.errors['sound-effects'], /checksum/)
  state.corruptDownload = false
  const repaired = await manager.install('sound-effects')
  assert.equal(repaired.installed['sound-effects'].manifest.version, '1.1.0')
  assert.equal(repaired.errors['sound-effects'], undefined)
  await assert.rejects(fs.stat(initial.directory), { code: 'ENOENT' })
})

test('Folia API 2 installs, updates and removes its entire engine directory', async t => {
  const { manager, state, root } = await fixture(t)
  const rootCatalog = path.join(project, 'plugins/official')
  const entry = parseCatalog(await fs.readFile(path.join(rootCatalog, 'catalog-v2.json'))).plugins.find(entry => entry.id === 'folia-lyrics')
  state.packages.push({ entry, archive: await fs.readFile(path.join(rootCatalog, entry.path)) })
  await manager.refresh()
  const first = (await manager.install('folia-lyrics')).installed['folia-lyrics']
  assert.equal(first.manifest.apiVersion, 2)
  assert.ok(await fs.stat(path.join(first.directory, 'engine/index.html')))
  const second = (await manager.install('folia-lyrics')).installed['folia-lyrics']
  assert.notEqual(second.directory, first.directory)
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' })
  assert.deepEqual((await manager.uninstall('folia-lyrics')).installed, {})
  assert.deepEqual(await fs.readdir(root), ['catalog-cache.json', 'installed.json'])
})

test('concurrent install and uninstall are serialized and unsupported plugin APIs are rejected', async t => {
  const { manager, state, root } = await fixture(t)
  await manager.refresh()
  await Promise.all([manager.install('sound-effects'), manager.uninstall('sound-effects')])
  assert.deepEqual((await manager.snapshot()).installed, {})
  assert.deepEqual(await fs.readdir(root), ['catalog-cache.json', 'installed.json'])
  state.packages[0].entry.apiVersion = 99
  await manager.refresh()
  await assert.rejects(manager.install('sound-effects'), /different application version/)
  await assert.rejects(manager.install('../outside'), /Unknown official plugin/)
})

test('previously unknown catalog plugins install, update and retain metadata offline', async t => {
  const { manager, state, restart } = await fixture(t)
  const id = 'new-plugin2'
  const name = { 'zh-cn': '目录中的新插件', 'en-us': 'A new catalog plugin' }
  const make = version => {
    const result = bundle(id, version, archive => { archive.manifest.name = name; return archive })
    result.entry.name = name
    return result
  }
  state.packages.push(make('1.0.0'))
  await manager.refresh()
  const first = (await manager.install(id)).installed[id]
  assert.equal(first.manifest.name['zh-cn'], name['zh-cn'])
  state.packages[2] = make('1.1.0')
  await manager.refresh()
  assert.equal((await manager.install(id)).installed[id].manifest.version, '1.1.0')
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' })
  state.offline = true
  const reopened = restart()
  const snapshot = await reopened.snapshot()
  assert.equal(snapshot.catalog.find(plugin => plugin.id === id).name['zh-cn'], name['zh-cn'])
  assert.equal(snapshot.installed[id].manifest.version, '1.1.0')
  assert.equal((await reopened.refresh()).catalog.length, 3)
  assert.equal((await reopened.uninstall(id)).installed[id], undefined)
  await assert.rejects(manager.install('not-in-the-catalog'), /not published/)
})

test('dynamic metadata rejects unsafe keys and malformed entries without losing the last good catalog', async t => {
  const { manager, state, restart } = await fixture(t)
  for (const id of ['constructor', 'prototype', '__proto__', '../outside', 'C:drive', 'bad.name', 'CON', 'nul', 'a'.repeat(65)]) assert.equal(isPluginId(id), false, id)
  await manager.refresh()
  for (const patch of [{ name: { en: { text: 'bad' } } }, { description: 'x'.repeat(2001) }, { icon: 'https://example.com/icon.svg' }]) {
    const { entry } = bundle('brand-new-plugin')
    assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, ...patch }] }))))
  }
  state.packages[0].entry.name = { 'en-us': 123 }
  assert.ok((await manager.refresh()).catalogError)
  assert.equal((await restart().snapshot()).catalog.length, 2)
})

test('an altered registration cannot remove another plugin directory', async t => {
  const { manager, state, root } = await fixture(t)
  state.packages.push(bundle('brand-new-plugin'))
  await manager.refresh()
  await manager.install('sound-effects')
  const snapshot = await manager.install('brand-new-plugin')
  const filename = path.join(root, 'installed.json')
  const registry = JSON.parse(await fs.readFile(filename, 'utf8'))
  registry['brand-new-plugin'] = registry['sound-effects']
  await fs.writeFile(filename, JSON.stringify(registry))
  await assert.rejects(manager.uninstall('brand-new-plugin'), /Invalid installed plugin directory/)
  assert.ok(await fs.stat(snapshot.installed['sound-effects'].directory))
})

test('catalog text falls back by locale and updates compare numeric versions', () => {
  assert.equal(pluginText({ 'zh-cn': '插件', 'en-us': 'Plugin' }, 'zh-cn'), '插件')
  assert.equal(pluginText({ 'en-us': 'Plugin' }, 'zh-tw'), 'Plugin')
  assert.equal(pluginText(undefined, 'zh-cn', 'remote-id'), 'remote-id')
  assert.equal(comparePluginVersions('1.10.0', '1.9.0'), 1)
  assert.equal(comparePluginVersions('1.0.0', '1.1.0'), -1)
  assert.equal(comparePluginVersions('1.1.0', '1.1.0'), 0)
})
