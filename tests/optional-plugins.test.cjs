const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const Module = require('node:module')
const { createHash } = require('node:crypto')
const { packSource, unpackSource, readZip, writeZip } = require('../src/common/pluginSource')
const { packPlugin, unpackPlugin } = require('../src/common/pluginPackage')
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
  loaded.require = name => {
    if (!name.startsWith('@common/')) return originalRequire(name)
    const target = path.join(project, 'src/common', name.slice('@common/'.length))
    return fsSync.existsSync(target + '.ts') ? loadTs(target + '.ts') : originalRequire(target + '.js')
  }
  modules.set(filename, loaded)
  loaded._compile(ts.transpileModule(fsSync.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename)
  return loaded.exports
}
const { PluginManager, parseCatalog } = loadTs(path.join(project, 'src/main/modules/optionalPlugins/manager.ts'))
const { OFFICIAL_PLUGIN_ROOT, PLUGIN_CATALOG_FILE, pluginText, comparePluginVersions, isPluginId } = loadTs(path.join(project, 'src/common/optionalPlugins.ts'))
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const bundle = async(id, version = '1.0.0', extra = {}) => {
  const manifest = { id, version, apiVersion: 3, entry: 'src/index.js', assets: [{ from: 'src/assets', to: 'assets' }], ...extra }
  const archive = await packSource(manifest, new Map([
    ['src/index.js', Buffer.from('module.exports.default = { components: {} }')],
    ['src/assets/data.txt', Buffer.from('asset')],
    ['LICENSE', Buffer.from('Keep this license')],
  ]))
  return { archive, entry: { id, version, apiVersion: manifest.apiVersion, name: manifest.name, path: id + '/' + version + '/' + hash(archive) + '.zip', bytes: archive.length, sha256: hash(archive) } }
}
const compiledBundle = (id, version = '1.0.0', extra = {}) => {
  const data = Buffer.from('module.exports.default = { components: {}, compiled: true }')
  const manifest = { id, version, apiVersion: 3, entry: 'renderer.js', styles: [], files: [{ path: 'renderer.js', bytes: data.length, sha256: hash(data) }], ...extra }
  const archive = packPlugin(manifest, [{ path: 'renderer.js', data }])
  return { archive, entry: { path: `${id}/${version}/${hash(archive)}.lxplugin`, bytes: archive.length, sha256: hash(archive) } }
}
async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-plugin-manager-'))
  const root = path.join(temporary, 'plugins')
  await fs.mkdir(root)
  t.after(async() => {
    assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(), 'lx-plugin-manager-')))
    await fs.rm(temporary, { recursive: true, force: true })
  })
  const state = { packages: [await bundle('test-effects'), await bundle('audio-visualizer')], offline: false, corruptDownload: false, compileError: false, compilations: 0 }
  const fetchBinary = async url => {
    if (state.offline) throw new Error('Offline')
    if (url === OFFICIAL_PLUGIN_ROOT + PLUGIN_CATALOG_FILE) return Buffer.from(JSON.stringify({ schemaVersion: 2, plugins: state.packages.map(item => item.entry) }))
    const item = state.packages.flatMap(item => [item, ...(item.compiled ? [item.compiled] : [])]).find(item => url === OFFICIAL_PLUGIN_ROOT + item.entry.path)
    assert.ok(item, url)
    return state.corruptDownload ? Buffer.from('broken') : item.archive
  }
  // Isolate transactions here; plugin-source tests exercise the real compiler.
  const compileSource = async(source, output, manifest) => {
    state.compilations++
    if (state.compileError) throw new Error('Test compiler failure')
    await fs.mkdir(output)
    await fs.copyFile(path.join(source, manifest.entry), path.join(output, 'renderer.js'))
    for (const asset of manifest.assets ?? []) await fs.cp(path.join(source, asset.from), path.join(output, asset.to), { recursive: true })
  }
  const restart = () => new PluginManager(root, fetchBinary, { compileSource })
  const writePackage = async(item, name = 'incoming.zip') => {
    const filename = path.join(temporary, name)
    await fs.writeFile(filename, item.archive)
    return filename
  }
  return { root, files: temporary, state, manager: restart(), restart, writePackage }
}

test('the text catalog advertises verified source ZIP and LXPlugin packages for all four plugins', async() => {
  const root = path.join(project, 'plugins/store')
  const catalog = parseCatalog(await fs.readFile(path.join(root, PLUGIN_CATALOG_FILE)))
  assert.deepEqual(catalog.plugins.map(entry => entry.id).sort(), ['audio-tag-editor', 'audio-visualizer', 'folia-lyrics', 'sound-effects'])
  for (const entry of catalog.plugins) {
    assert.equal(entry.path.endsWith('.zip'), true)
    assert.equal(Object.hasOwn(entry, 'sourcePackage'), false)
    const bytes = await fs.readFile(path.join(root, entry.path))
    assert.equal(bytes.length, entry.bytes)
    assert.equal(hash(bytes), entry.sha256)
    const { manifest, files } = await unpackSource(bytes)
    for (const key of ['id', 'version', 'apiVersion']) assert.equal(manifest[key], entry[key])
    assert.ok(files.has('src/index.ts'))
    assert.ok(files.has('LICENSE'))
    assert.equal(files.has('renderer.js'), false)
    const compiled = entry.packages.lxplugin
    const compiledBytes = await fs.readFile(path.join(root, compiled.path))
    assert.equal(compiledBytes.length, compiled.bytes)
    assert.equal(hash(compiledBytes), compiled.sha256)
    const compiledArchive = unpackPlugin(compiledBytes)
    for (const key of ['id', 'version', 'apiVersion']) assert.equal(compiledArchive.manifest[key], entry[key])
    for (const file of compiledArchive.manifest.files) {
      const bytes = Buffer.from(compiledArchive.files[file.path], 'base64')
      assert.equal(bytes.length, file.bytes)
      assert.equal(hash(bytes), file.sha256)
    }
    if (entry.id === 'sound-effects') assert.ok([...files.keys()].some(name => name.startsWith('src/filters/')))
    if (entry.id === 'audio-visualizer') assert.ok(files.has(manifest.lyricEntry))
    if (entry.id === 'folia-lyrics') assert.ok(files.has(manifest.browser.entry))
  }
  assert.throws(() => parseCatalog(fsSync.readFileSync(path.join(project, 'plugins/official/catalog-v2.json'))), /Invalid plugin catalog/)
})

test('built-in features ignore legacy installations and reject package replacement without touching saved data', async t => {
  const { manager, root, state, writePackage } = await fixture(t)
  const legacy = {
    'sound-effects': { directory: 'old-missing-effects', manifestHash: 'invalid', source: 'official' },
    'audio-tag-editor': { directory: 'old-damaged-editor', manifestHash: 'invalid', source: 'local' },
  }
  const saved = JSON.stringify(legacy)
  await fs.writeFile(path.join(root, 'installed.json'), saved)
  state.offline = true
  const snapshot = await manager.refresh()
  assert.deepEqual(snapshot.installed, {})
  assert.deepEqual(snapshot.errors, {})
  assert.deepEqual(snapshot.sources, {})
  for (const id of Object.keys(legacy)) {
    await assert.rejects(manager.install(id), { code: 'builtin' })
    await assert.rejects(manager.uninstall(id), { code: 'builtin' })
    await assert.rejects(manager.createExport(id), { code: 'builtin' })
    await assert.rejects(manager.prepareImport(await writePackage(await bundle(id))), { code: 'builtin' })
    await assert.rejects(manager.prepareImport(await writePackage(compiledBundle(id), 'incoming.lxplugin')), { code: 'builtin' })
  }
  assert.equal(state.compilations, 0)
  assert.equal(await fs.readFile(path.join(root, 'installed.json'), 'utf8'), saved)
})

test('catalog rejects unsafe URLs, unknown formats, duplicate IDs and oversized packages', async() => {
  const { entry } = await bundle('test-effects')
  for (const patch of [{ path: '../escape.zip' }, { path: 'https://example.com/a.zip' }, { path: 'test-effects/1.0.0/a/../b.zip' }, { path: entry.path.replace('.zip', '.tar') }, { id: 'unknown' }, { bytes: 64 * 1024 * 1024 + 1 }]) {
    assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 2, plugins: [{ ...entry, ...patch }] }))))
  }
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 1, plugins: [entry] }))))
  assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 2, plugins: [entry, entry] }))))
  const compiled = compiledBundle(entry.id)
  for (const packages of [[], { exe: compiled.entry }, { lxplugin: entry }, { lxplugin: { ...compiled.entry, path: '../escape.lxplugin' } }, { lxplugin: { ...compiled.entry, bytes: 20 * 1024 * 1024 + 1 } }]) {
    assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 2, plugins: [{ ...entry, packages }] }))))
  }
})

test('store defaults to LXPlugin, can explicitly compile ZIP, and rolls back a failed format change', async t => {
  const { manager, state, root, restart } = await fixture(t)
  const item = state.packages[0]
  item.compiled = compiledBundle(item.entry.id)
  item.entry.packages = { lxplugin: item.compiled.entry }
  await manager.refresh()
  const compiled = (await manager.install(item.entry.id)).installed[item.entry.id]
  assert.equal(compiled.format, 'lxplugin')
  assert.equal(state.compilations, 0)
  assert.deepEqual((await fs.readdir(compiled.directory)).sort(), ['manifest.json', 'renderer.js'])
  state.offline = true
  const offline = restart()
  assert.equal((await offline.snapshot()).installed[item.entry.id].directory, compiled.directory)
  const exported = await offline.createExport(item.entry.id)
  assert.equal(exported.format, 'lxplugin')
  assert.deepEqual(unpackPlugin(exported.bytes), unpackPlugin(item.compiled.archive))
  state.offline = false
  const source = (await manager.install(item.entry.id, 'zip')).installed[item.entry.id]
  assert.equal(source.format, 'zip')
  assert.equal(state.compilations, 1)
  assert.equal((await manager.createExport(item.entry.id)).format, 'zip')
  state.corruptDownload = true
  await assert.rejects(manager.install(item.entry.id), /checksum/)
  assert.equal((await manager.snapshot()).installed[item.entry.id].directory, source.directory)
  state.corruptDownload = false
  item.compiled = compiledBundle(item.entry.id, '2.0.0')
  item.compiled.entry.path = item.compiled.entry.path.replace('/2.0.0/', '/1.0.0/')
  item.entry.packages = { lxplugin: item.compiled.entry }
  await manager.refresh()
  await assert.rejects(manager.install(item.entry.id), /does not match/)
  await assert.rejects(manager.install(item.entry.id, 'exe'), /format/)
  assert.equal((await manager.snapshot()).installed[item.entry.id].directory, source.directory)
  assert.equal((await fs.readdir(root)).some(name => /^(install|source)-/.test(name)), false)
})

test('compiled imports work without a compiler, export offline and recognize legacy installed records', async t => {
  const { root, files, writePackage } = await fixture(t)
  const manager = new PluginManager(root, async() => { throw new Error('Offline') })
  const item = compiledBundle('compiled-local')
  const filename = await writePackage(item, 'compiled.LXPLUGIN')
  const prepared = await manager.prepareImport(filename)
  assert.equal(prepared.format, 'lxplugin')
  const installed = (await manager.importPrepared(prepared)).installed['compiled-local']
  assert.equal(installed.source, 'local')
  const exported = await manager.createExport('compiled-local')
  const destination = path.join(files, 'exported.lxplugin')
  await manager.writeExport(destination, exported.bytes, exported.format)
  assert.deepEqual(unpackPlugin(await fs.readFile(destination)), unpackPlugin(item.archive))
  const registryPath = path.join(root, 'installed.json')
  const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'))
  delete registry['compiled-local'].format
  await fs.writeFile(registryPath, JSON.stringify(registry))
  assert.equal((await manager.snapshot()).installed['compiled-local'].format, 'lxplugin')
  await fs.writeFile(path.join(installed.directory, 'renderer.js'), 'corrupt')
  assert.match((await manager.snapshot()).errors['compiled-local'], /checksum/)
  await assert.rejects(manager.createExport('compiled-local'), { code: 'corrupt_installation' })
})

test('compiled packages reject traversal, missing files, tampering, invalid encoding and incompatible APIs', async t => {
  const { manager, state, writePackage } = await fixture(t)
  const original = unpackPlugin(compiledBundle('checked-plugin').archive)
  const { gzipSync } = require('node:zlib')
  for (const mutate of [
    archive => { archive.manifest.files[0].path = '../escape.js' },
    archive => { archive.manifest.id = '../escape' },
    archive => { archive.files = {} },
    archive => { archive.files['extra.js'] = '' },
    archive => { archive.files['renderer.js'] = Buffer.from('changed').toString('base64') },
    archive => { archive.files['renderer.js'] = '!'.repeat(archive.files['renderer.js'].length) },
  ]) {
    const archive = structuredClone(original)
    mutate(archive)
    await assert.rejects(manager.prepareImport(await writePackage({ archive: gzipSync(JSON.stringify(archive)) }, 'invalid.lxplugin')), { code: 'invalid_package' })
  }
  await assert.rejects(manager.prepareImport(await writePackage(compiledBundle('checked-plugin', '1.0.0', { apiVersion: 99 }), 'future.lxplugin')), { code: 'incompatible' })
  assert.equal(state.compilations, 0)
})

test('plugins compile independently, restart offline and uninstall only their own files', async t => {
  const { manager, state, root, restart } = await fixture(t)
  await fs.writeFile(path.join(root, 'preserved-settings.json'), '{"eq":6}')
  await manager.refresh()
  const first = (await manager.install('test-effects')).installed['test-effects']
  await manager.install('audio-visualizer')
  state.offline = true
  const reopened = restart()
  assert.equal(Object.keys((await reopened.snapshot()).installed).length, 2)
  assert.equal(state.compilations, 2, 'Restart uses saved compiled files')
  assert.equal((await reopened.refresh()).catalogError, 'Offline')
  assert.deepEqual(Object.keys((await reopened.uninstall('test-effects')).installed), ['audio-visualizer'])
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' })
  assert.equal(await fs.readFile(path.join(root, 'preserved-settings.json'), 'utf8'), '{"eq":6}')
})

test('store installs retain sources but no downloaded ZIP or compilation workspace, and export offline', async t => {
  const { manager, state, root, restart } = await fixture(t)
  await manager.refresh()
  const installed = (await manager.install('test-effects')).installed['test-effects']
  assert.deepEqual((await fs.readdir(installed.directory)).sort(), ['.source', 'assets', 'manifest.json', 'renderer.js'])
  assert.deepEqual((await fs.readdir(root)).sort(), ['catalog-cache.json', 'installed.json', path.basename(installed.directory)].sort())
  await assert.rejects(fs.stat(path.join(installed.directory, '.source.zip')), { code: 'ENOENT' })
  state.offline = true
  const exported = await restart().createExport('test-effects')
  assert.deepEqual(await unpackSource(exported.bytes), await unpackSource(state.packages[0].archive))
})

test('repacking a wrapped ZIP preserves source contents and leaves the imported file untouched', async t => {
  const { manager, writePackage } = await fixture(t)
  const item = await bundle('wrapped-plugin')
  const payload = await readZip(item.archive)
  item.archive = await writeZip(new Map([...payload].map(([name, bytes]) => ['wrapped/' + name, bytes])))
  const filename = await writePackage(item)
  await manager.importPrepared(await manager.prepareImport(filename))
  const exported = await manager.createExport('wrapped-plugin')
  assert.notDeepEqual(exported.bytes, item.archive, 'Export reconstructs a normalized ZIP')
  assert.deepEqual(await unpackSource(exported.bytes), await unpackSource(item.archive))
  assert.deepEqual(await fs.readFile(filename), item.archive)
})

test('a source write failure rolls back the update and removes all incomplete files', async t => {
  const { manager, state, root } = await fixture(t)
  await manager.refresh()
  const installed = (await manager.install('test-effects')).installed['test-effects']
  state.packages[0] = await bundle('test-effects', '1.1.0')
  await manager.refresh()
  const writeFile = fs.writeFile
  fs.writeFile = async(filename, ...args) => {
    if (filename.includes(path.sep + '.source' + path.sep) && path.basename(filename) === 'index.js') throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' })
    return writeFile(filename, ...args)
  }
  try { await assert.rejects(manager.install('test-effects'), { code: 'ENOSPC' }) } finally { fs.writeFile = writeFile }
  assert.equal((await manager.snapshot()).installed['test-effects'].directory, installed.directory)
  assert.deepEqual((await fs.readdir(root)).sort(), ['catalog-cache.json', 'installed.json', path.basename(installed.directory)].sort())
  assert.deepEqual(await unpackSource((await manager.createExport('test-effects')).bytes), await unpackSource((await bundle('test-effects')).archive))
})

test('source junctions and source manifest tampering cannot be exported', async t => {
  const { manager, files, writePackage } = await fixture(t)
  const id = 'source-junction'
  const installed = (await manager.importPrepared(await manager.prepareImport(await writePackage(await bundle(id))))).installed[id]
  const sourceDirectory = path.join(installed.directory, '.source')
  const external = path.join(files, 'external-source')
  await fs.rename(path.join(sourceDirectory, 'src'), external)
  await fs.symlink(external, path.join(sourceDirectory, 'src'), 'junction')
  await assert.rejects(manager.createExport(id), { code: 'corrupt_installation' })
  await fs.unlink(path.join(sourceDirectory, 'src'))
  await fs.rename(external, path.join(sourceDirectory, 'src'))
  await fs.writeFile(path.join(sourceDirectory, 'plugin.json'), '{}')
  assert.match((await manager.snapshot()).errors[id], /checksum/)
  await assert.rejects(manager.createExport(id), { code: 'corrupt_installation' })
})

test('download, metadata and compilation failures preserve the previous installation', async t => {
  const { manager, state, root } = await fixture(t)
  await manager.refresh()
  const first = (await manager.install('test-effects')).installed['test-effects']
  state.packages[0] = await bundle('test-effects', '1.1.0')
  await manager.refresh()
  state.corruptDownload = true
  await assert.rejects(manager.install('test-effects'), /checksum/)
  state.corruptDownload = false
  state.packages[0].entry.version = '1.2.0'
  state.packages[0].entry.path = state.packages[0].entry.path.replace('/1.1.0/', '/1.2.0/')
  await manager.refresh()
  await assert.rejects(manager.install('test-effects'), /does not match/)
  state.packages[0] = await bundle('test-effects', '1.1.0')
  await manager.refresh()
  state.compileError = true
  await assert.rejects(manager.install('test-effects'), { code: 'compile_failed' })
  assert.equal((await manager.snapshot()).installed['test-effects'].directory, first.directory)
  assert.equal((await fs.readdir(root)).some(name => /^(source|install)-/.test(name)), false)
  state.compileError = false
  await fs.writeFile(path.join(first.directory, 'renderer.js'), 'corrupt')
  assert.match((await manager.snapshot()).errors['test-effects'], /checksum/)
  assert.equal((await manager.install('test-effects')).installed['test-effects'].manifest.version, '1.1.0')
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' })
})

test('concurrent changes are serialized and unsupported APIs are rejected', async t => {
  const { manager, state, root } = await fixture(t)
  await manager.refresh()
  await Promise.all([manager.install('test-effects'), manager.uninstall('test-effects')])
  assert.deepEqual((await manager.snapshot()).installed, {})
  assert.deepEqual(await fs.readdir(root), ['catalog-cache.json', 'installed.json'])
  state.packages[0].entry.apiVersion = 99
  await manager.refresh()
  await assert.rejects(manager.install('test-effects'), /different application version/)
  await assert.rejects(manager.install('../outside'), /Unknown official plugin/)
})

test('unknown catalog plugins update and retain metadata offline', async t => {
  const { manager, state, restart } = await fixture(t)
  const id = 'new-plugin2'
  const name = { 'zh-cn': '目录中的新插件', 'en-us': 'A new catalog plugin' }
  state.packages.push(await bundle(id, '1.0.0', { name }))
  await manager.refresh()
  const first = (await manager.install(id)).installed[id]
  assert.equal(first.manifest.name['zh-cn'], name['zh-cn'])
  state.packages[2] = await bundle(id, '1.1.0', { name })
  await manager.refresh()
  assert.equal((await manager.install(id)).installed[id].manifest.version, '1.1.0')
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' })
  state.offline = true
  const reopened = restart()
  const snapshot = await reopened.snapshot()
  assert.equal(snapshot.catalog.find(plugin => plugin.id === id).name['zh-cn'], name['zh-cn'])
  assert.equal((await reopened.refresh()).catalog.length, 3)
  assert.equal((await reopened.uninstall(id)).installed[id], undefined)
  await assert.rejects(manager.install('not-in-the-catalog'), /not published/)
})

test('malformed metadata keeps the last good catalog and IDs cannot address another installation', async t => {
  const { manager, state, restart, root } = await fixture(t)
  for (const id of ['constructor', 'prototype', '__proto__', '../outside', 'C:drive', 'bad.name', 'CON', 'nul', 'a'.repeat(65)]) assert.equal(isPluginId(id), false, id)
  await manager.refresh()
  const { entry } = await bundle('brand-new-plugin')
  for (const patch of [{ name: { en: { text: 'bad' } } }, { description: 'x'.repeat(2001) }, { icon: 'https://example.com/icon.svg' }]) {
    assert.throws(() => parseCatalog(Buffer.from(JSON.stringify({ schemaVersion: 2, plugins: [{ ...entry, ...patch }] }))))
  }
  state.packages[0].entry.name = { 'en-us': 123 }
  assert.ok((await manager.refresh()).catalogError)
  assert.equal((await restart().snapshot()).catalog.length, 2)
  const first = (await manager.install('test-effects')).installed['test-effects']
  const filename = path.join(root, 'installed.json')
  const registry = JSON.parse(await fs.readFile(filename, 'utf8'))
  registry['brand-new-plugin'] = registry['test-effects']
  await fs.writeFile(filename, JSON.stringify(registry))
  await assert.rejects(manager.uninstall('brand-new-plugin'), /Invalid installed plugin directory/)
  assert.ok(await fs.stat(first.directory))
})

test('catalog text falls back by locale and versions compare numerically', () => {
  assert.equal(pluginText({ 'zh-cn': '插件', 'en-us': 'Plugin' }, 'zh-cn'), '插件')
  assert.equal(pluginText({ 'en-us': 'Plugin' }, 'zh-tw'), 'Plugin')
  assert.equal(pluginText(undefined, 'zh-cn', 'remote-id'), 'remote-id')
  assert.equal(comparePluginVersions('1.10.0', '1.9.0'), 1)
  assert.equal(comparePluginVersions('1.0.0', '1.1.0'), -1)
  assert.equal(comparePluginVersions('1.1.0', '1.1.0'), 0)
})

test('offline imports reconstruct a source ZIP without settings or extra installed files', async t => {
  const { manager, state, root, restart, files, writePackage } = await fixture(t)
  state.offline = true
  const id = 'local-only-plugin'
  const item = await bundle(id, '1.2.0', { name: { 'zh-cn': '本地插件' } })
  const prepared = await manager.prepareImport(await writePackage(item))
  assert.equal(prepared.replacing, false)
  assert.equal(state.compilations, 0)
  const installed = (await manager.importPrepared(prepared)).installed[id]
  assert.equal(installed.source, 'local')
  await fs.mkdir(path.join(root, 'preferences'))
  await fs.writeFile(path.join(root, 'preferences', id + '.json'), 'PRIVATE_PREFERENCES')
  await fs.writeFile(path.join(installed.directory, 'private-extra.txt'), 'PRIVATE_EXTRA')
  const exported = await manager.createExport(id)
  assert.deepEqual(exported.bytes, item.archive)
  const output = await manager.writeExport(path.join(files, 'export.zip'), exported.bytes)
  await manager.uninstall(id)
  const reopened = restart()
  const restored = (await reopened.importPrepared(await reopened.prepareImport(output))).installed[id]
  assert.equal(restored.manifest.name['zh-cn'], '本地插件')
  assert.equal((await restart().snapshot()).installed[id].source, 'local')
  assert.equal(await fs.readFile(path.join(root, 'preferences', id + '.json'), 'utf8'), 'PRIVATE_PREFERENCES')
  await assert.rejects(fs.stat(path.join(restored.directory, 'private-extra.txt')), { code: 'ENOENT' })
})

test('confirmation rejects stale replacements and supports downgrades and repairs', async t => {
  const { manager, writePackage } = await fixture(t)
  const id = 'local-versioned'
  const prepare = async version => manager.prepareImport(await writePackage(await bundle(id, version)))
  const initial = (await manager.importPrepared(await prepare('1.0.0'))).installed[id]
  const pending = await prepare('1.1.0')
  assert.equal(pending.previousVersion, '1.0.0')
  assert.equal((await manager.snapshot()).installed[id].directory, initial.directory)
  const newer = (await manager.importPrepared(await prepare('1.2.0'))).installed[id]
  await assert.rejects(manager.importPrepared(pending), { code: 'changed' })
  assert.equal((await manager.snapshot()).installed[id].directory, newer.directory)
  const downgraded = (await manager.importPrepared(await prepare('1.0.0'))).installed[id]
  const same = (await manager.importPrepared(await prepare('1.0.0'))).installed[id]
  assert.notEqual(same.directory, downgraded.directory)
  await fs.writeFile(path.join(same.directory, 'renderer.js'), 'broken')
  const repair = await prepare('1.0.0')
  assert.equal(repair.replacing, true)
  assert.equal(repair.previousVersion, null)
  assert.equal((await manager.importPrepared(repair)).errors[id], undefined)
})

test('legacy LXPlugin imports are supported while renamed archives and invalid ZIPs are rejected', async t => {
  const { manager, state, root, writePackage } = await fixture(t)
  const id = 'safe-local'
  const item = await bundle(id)
  const first = (await manager.importPrepared(await manager.prepareImport(await writePackage(item)))).installed[id]
  const oldCatalog = require('../plugins/official/catalog-v2.json')
  const oldBytes = await fs.readFile(path.join(project, 'plugins/official', oldCatalog.plugins.find(plugin => plugin.id === 'audio-visualizer').path))
  const legacy = await manager.prepareImport(await writePackage({ archive: oldBytes }, 'legacy.lxplugin'))
  assert.equal(legacy.format, 'lxplugin')
  assert.equal((await manager.importPrepared(legacy)).installed[legacy.manifest.id].format, 'lxplugin')
  await assert.rejects(manager.prepareImport(await writePackage({ archive: oldBytes }, 'renamed.zip')), { code: 'invalid_package' })
  await assert.rejects(manager.prepareImport(await writePackage(item, 'source.lxplugin')), { code: 'invalid_package' })
  const altered = await readZip(item.archive)
  altered.set('src/index.js', Buffer.from('changed'))
  for (const archive of [await writeZip(altered), Buffer.from('not ZIP')]) await assert.rejects(manager.prepareImport(await writePackage({ archive })), { code: 'invalid_package' })
  await assert.rejects(manager.prepareImport(await writePackage(await bundle(id, '2.0.0', { apiVersion: 99 }))), { code: 'incompatible' })
  await assert.rejects(manager.prepareImport(await writePackage({ archive: Buffer.alloc(64 * 1024 * 1024 + 1) })), { code: 'read_failed' })
  await assert.rejects(manager.prepareImport(path.join(root, 'missing.zip')), { code: 'read_failed' })
  assert.equal((await manager.snapshot()).installed[id].directory, first.directory)
  assert.equal(state.compilations, 1)
})

test('installations without source ZIPs require reinstall and retain settings', async t => {
  const { manager, root, restart } = await fixture(t)
  await manager.refresh()
  const id = 'test-effects'
  const first = (await manager.install(id)).installed[id]
  const registryFile = path.join(root, 'installed.json')
  const registry = JSON.parse(await fs.readFile(registryFile, 'utf8'))
  delete registry[id].sourceManifestHash
  await fs.writeFile(registryFile, JSON.stringify(registry))
  await fs.mkdir(path.join(root, 'preferences'))
  await fs.writeFile(path.join(root, 'preferences', id + '.json'), '{"volume":6}')
  const reopened = restart()
  const snapshot = await reopened.snapshot()
  assert.equal(snapshot.installed[id], undefined)
  assert.match(snapshot.errors[id], /sources are missing/)
  await assert.rejects(reopened.createExport(id), { code: 'corrupt_installation' })
  assert.ok(await fs.stat(first.directory))
  assert.notEqual((await reopened.install(id)).installed[id].directory, first.directory)
  assert.equal(await fs.readFile(path.join(root, 'preferences', id + '.json'), 'utf8'), '{"volume":6}')
})

test('failed registry and export writes keep the previous installation and backup', async t => {
  const { manager, root, files, writePackage } = await fixture(t)
  const id = 'atomic-local'
  const first = (await manager.importPrepared(await manager.prepareImport(await writePackage(await bundle(id))))).installed[id]
  const pending = await manager.prepareImport(await writePackage(await bundle(id, '1.1.0')))
  const rename = fs.rename
  fs.rename = async(source, destination) => {
    if (destination === path.join(root, 'installed.json')) throw Object.assign(new Error('Registry locked'), { code: 'EPERM' })
    return rename(source, destination)
  }
  try { await assert.rejects(manager.importPrepared(pending), { code: 'EPERM' }) } finally { fs.rename = rename }
  assert.equal((await manager.snapshot()).installed[id].directory, first.directory)
  assert.deepEqual((await fs.readdir(root)).sort(), [path.basename(first.directory), 'installed.json'].sort())
  const exported = await manager.createExport(id)
  const target = path.join(await fs.realpath(files), 'kept.zip')
  await fs.writeFile(target, 'existing backup')
  fs.rename = async(source, destination) => {
    if (destination === target) throw Object.assign(new Error('Target locked'), { code: 'EBUSY' })
    return rename(source, destination)
  }
  try { await assert.rejects(manager.writeExport(target, exported.bytes), { code: 'EBUSY' }) } finally { fs.rename = rename }
  assert.equal(await fs.readFile(target, 'utf8'), 'existing backup')
  assert.equal((await fs.readdir(files)).some(name => name.endsWith('.tmp')), false)
  await manager.writeExport(target, exported.bytes)
  assert.deepEqual(await fs.readFile(target), exported.bytes)
})

test('exports reject old extensions, damaged source files and installed paths', async t => {
  const { manager, state, root, files } = await fixture(t)
  await manager.refresh()
  const installed = (await manager.install('test-effects')).installed['test-effects']
  const exported = await manager.createExport('test-effects')
  assert.deepEqual(exported.bytes, state.packages[0].archive)
  for (const target of [path.join(root, 'bad.zip'), path.join(installed.directory, 'bad.zip'), path.join(files, 'wrong.lxplugin')]) await assert.rejects(manager.writeExport(target, exported.bytes), { code: 'invalid_destination' })
  const junction = path.join(files, 'plugin-link')
  await fs.symlink(root, junction, 'junction')
  await assert.rejects(manager.writeExport(path.join(junction, 'bad.zip'), exported.bytes), { code: 'invalid_destination' })
  await fs.unlink(junction)
  await fs.writeFile(path.join(installed.directory, '.source/src/index.js'), 'corrupt')
  await assert.rejects(manager.createExport('test-effects'), { code: 'corrupt_installation' })
  await assert.rejects(manager.createExport('not-installed'), { code: 'not_installed' })
  await assert.rejects(manager.createExport('../outside'), { code: 'not_installed' })
})

test('nested junctions cannot smuggle external files into exports or uninstall', async t => {
  const { manager, files, writePackage } = await fixture(t)
  const id = 'linked-assets'
  const installed = (await manager.importPrepared(await manager.prepareImport(await writePackage(await bundle(id))))).installed[id]
  await fs.rename(path.join(installed.directory, 'assets'), path.join(files, 'external-assets'))
  await fs.symlink(path.join(files, 'external-assets'), path.join(installed.directory, 'assets'), 'junction')
  await assert.rejects(manager.createExport(id), { code: 'corrupt_installation' })
  assert.ok((await manager.snapshot()).errors[id])
  await manager.uninstall(id)
  assert.equal(await fs.readFile(path.join(files, 'external-assets/data.txt'), 'utf8'), 'asset')
})
