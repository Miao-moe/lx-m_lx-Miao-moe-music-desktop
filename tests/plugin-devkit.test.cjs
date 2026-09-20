const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { test } = require('node:test')
const { readZip, writeZip, unpackSource, hash } = require('../src/common/pluginSource')

const root = path.resolve(__dirname, '..')
const execute = promisify(execFile)
const isolatedKit = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-plugin-devkit-'))
  t.after(async() => {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'lx-plugin-devkit-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  // Only the distributed ZIP goes to the other machine; no repository/node_modules.
  const files = await readZip(await fs.readFile(path.join(root, 'plugins/lx-m-plugin-devkit-1.0.0.zip')))
  for (const [name, bytes] of files) {
    const filename = path.join(directory, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, bytes)
  }
  const cli = path.join(directory, 'developer-kit/lx-plugin.cjs')
  const run = (...args) => execute(process.execPath, [cli, ...args], {
    cwd: directory,
    windowsHide: true,
    env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
  })
  return { directory, run }
}

test('the distributed toolkit creates, edits, checks and reproducibly repacks projects outside the repository', async t => {
  const { directory, run } = await isolatedKit(t)
  const source = path.join(directory, '插件 with spaces')
  const output = source + '.zip'
  await run('init', source, 'independent-example')
  const info = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'))
  assert.equal(info.name, 'independent-example')
  await run('check', source)
  await run('pack', source)
  await run('check', output)
  const first = await fs.readFile(output)
  const unpacked = await unpackSource(first)
  assert.equal(unpacked.manifest.id, 'independent-example')
  assert.equal(unpacked.manifest.devkit.version, '1.0.0')
  for (const name of ['DEVELOPMENT.md', 'types/lx-m-plugin.d.ts', 'tsconfig.json', 'src/Settings.vue', 'LICENSE']) assert.ok(unpacked.files.has(name), name)
  const second = path.join(directory, 'edited')
  await run('unpack', output, second)
  await run('pack', second, path.join(directory, 'second.zip'))
  assert.deepEqual(await fs.readFile(path.join(directory, 'second.zip')), first)
  await fs.appendFile(path.join(second, 'src/Settings.vue'), '\n<!-- author edit -->\n')
  await run('pack', second, output)
  assert.notEqual(hash(await fs.readFile(output)), hash(first))
  await run('check', output)
  await assert.rejects(run('init', source, 'new-id'), /Destination already exists/)
  await assert.rejects(run('init', path.join(directory, 'invalid'), '../bad'), /manifest/)
  await assert.rejects(fs.stat(path.join(directory, 'invalid')), { code: 'ENOENT' })
})

test('packing excludes local artifacts but preserves vendored builds and rejects unsafe outputs or damaged imports', async t => {
  const { directory, run } = await isolatedKit(t)
  const source = path.join(directory, 'example')
  const output = source + '.zip'
  await run('init', source)
  const privateFiles = ['.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '_netrc', '.ENV.production', 'src/config/.npmrc', 'vendor/main/pkg/.npmrc', 'vendor/main/pkg/.yarnrc.yml']
  for (const name of privateFiles) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await fs.writeFile(path.join(source, name), '//registry.example.invalid/:_authToken=FAKE_TEST_TOKEN\n')
  }
  for (const name of ['.env', '.env.local', '.git/config', 'dist/output.js', 'build/cache', 'node_modules/local/index.js', 'old.zip', 'local.log', 'vendor/main/pkg/dist/index.js', 'vendor/main/pkg/node_modules/nested/index.js']) {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true })
    await fs.writeFile(path.join(source, name), name)
  }
  await assert.rejects(run('pack', source, path.join(source, 'inside.zip')), /outside/)
  await run('pack', source, output)
  const { files } = await unpackSource(await fs.readFile(output))
  for (const name of privateFiles) assert.equal(files.has(name), false, name)
  assert.equal([...files.values()].some(bytes => bytes.includes('FAKE_TEST_TOKEN')), false)
  for (const name of ['.env', '.env.local', '.git/config', 'dist/output.js', 'build/cache', 'node_modules/local/index.js', 'old.zip', 'local.log']) assert.equal(files.has(name), false, name)
  for (const name of ['vendor/main/pkg/dist/index.js', 'vendor/main/pkg/node_modules/nested/index.js']) assert.ok(files.has(name), name)
  const corrupt = await readZip(await fs.readFile(output))
  corrupt.set('src/index.ts', Buffer.from('modified without updating checksums'))
  const broken = path.join(directory, 'broken.zip')
  await fs.writeFile(broken, await writeZip(corrupt))
  await assert.rejects(run('check', broken), /checksum/)
  const destination = path.join(directory, 'broken')
  await assert.rejects(run('unpack', broken, destination), /checksum/)
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' })
  const outside = path.join(directory, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'private.txt'), 'must not be read')
  await fs.symlink(outside, path.join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(run('pack', source, output), /symbolic links/)
})

test('vendor collects exact installed dependencies, peers and nested versions without executing package scripts', async t => {
  const { directory, run } = await isolatedKit(t)
  const source = path.join(directory, 'dependencies-example')
  await run('init', source)
  const save = async(name, value) => {
    const filename = path.join(source, name)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, typeof value === 'string' ? value : JSON.stringify(value))
  }
  await save('package.json', { dependencies: { library: '1.0.0' } })
  await save('node_modules/library/package.json', {
    name: 'library',
    version: '1.0.0',
    license: 'MIT',
    main: 'dist/index.js',
    dependencies: { nested: '2.0.0' },
    peerDependencies: { peer: '1.0.0' },
    optionalDependencies: { missing: '1.0.0' },
    scripts: { prepare: 'throw an error if executed' },
  })
  await save('node_modules/library/dist/index.js', 'module.exports = 1')
  await save('node_modules/library/LICENSE', 'Example license')
  await save('node_modules/library/.env', 'excluded')
  await save('node_modules/library/.npmrc', '//registry.example.invalid/:_authToken=FAKE_VENDOR_TOKEN')
  await save('node_modules/library/node_modules/nested/package.json', { name: 'nested', version: '2.0.0' })
  await save('node_modules/library/node_modules/nested/index.js', 'module.exports = 2')
  await save('node_modules/peer/package.json', { name: 'peer', version: '1.0.0' })
  await save('node_modules/peer/index.js', 'module.exports = 3')
  await run('vendor', source)
  await assert.rejects(run('vendor', source), /Destination already exists/)
  await run('pack', source)
  const { files } = await unpackSource(await fs.readFile(source + '.zip'))
  for (const name of ['library/dist/index.js', 'library/LICENSE', 'library/node_modules/nested/index.js', 'peer/index.js']) assert.ok(files.has('vendor/main/' + name), name)
  assert.equal(files.has('vendor/main/library/.env'), false)
  assert.equal(files.has('vendor/main/library/.npmrc'), false)
  assert.equal(JSON.parse(files.get('vendor/main/dependencies.json')).library.version, '1.0.0')
  await save('package.json', { dependencies: { library: '^1.0.0' } })
  await assert.rejects(run('vendor', source), /Pin library/)
})

test('vendor locates ESM-only and subpath-only packages without requiring exported metadata', async t => {
  const { directory, run } = await isolatedKit(t)
  const source = path.join(directory, 'esm-example')
  await run('init', source)
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ dependencies: { '@example/import-only': '1.0.0', 'subpaths-only': '2.0.0' } }))
  for (const [relative, info] of [
    ['@example/import-only', { name: '@example/import-only', version: '1.0.0', exports: { '.': { import: './index.js' } }, dependencies: { 'esm-nested': '3.0.0' } }],
    ['@example/import-only/node_modules/esm-nested', { name: 'esm-nested', version: '3.0.0', exports: { '.': { import: './index.js' } } }],
    ['subpaths-only', { name: 'subpaths-only', version: '2.0.0', exports: { './feature': './index.js' } }],
  ]) {
    const library = path.join(source, 'node_modules', relative)
    await fs.mkdir(library, { recursive: true })
    await fs.writeFile(path.join(library, 'package.json'), JSON.stringify({ type: 'module', ...info }))
    await fs.writeFile(path.join(library, 'index.js'), 'export const value = 42;')
  }
  await run('vendor', source)
  await run('pack', source)
  const { files } = await unpackSource(await fs.readFile(source + '.zip'))
  for (const relative of ['@example/import-only', '@example/import-only/node_modules/esm-nested', 'subpaths-only']) {
    assert.ok(files.has(`vendor/main/${relative}/package.json`), relative)
    assert.equal(files.get(`vendor/main/${relative}/index.js`).toString(), 'export const value = 42;')
  }
})

test('directory checks validate edited files without compressing and match the packed manifest', async t => {
  const { directory, run } = await isolatedKit(t)
  const source = path.join(directory, 'check-example')
  await run('init', source)
  await fs.appendFile(path.join(source, 'src/Settings.vue'), '\n<!-- edited before checking -->\n')
  const { checkProject, packProject } = require('../build-config/plugins/developer-kit/project.cjs')
  const deflate = t.mock.method(require('node:zlib'), 'createDeflateRaw', () => { throw new Error('Directory checks must not compress files') })
  let checked
  try {
    checked = await checkProject(source)
    assert.equal(checked.manifest.files.find(file => file.path === 'src/Settings.vue').sha256, hash(await fs.readFile(path.join(source, 'src/Settings.vue'))))
    const filename = path.join(source, 'plugin.json')
    const original = await fs.readFile(filename)
    await fs.writeFile(filename, JSON.stringify({ ...JSON.parse(original), entry: 'src/missing.ts' }))
    await assert.rejects(checkProject(source), /Invalid source manifest/)
    await fs.writeFile(filename, original)
  } finally { deflate.mock.restore() }
  const packed = await packProject(source)
  const unpacked = await unpackSource(await fs.readFile(packed.output))
  assert.deepEqual(checked.manifest, packed.manifest)
  assert.deepEqual(checked.manifest, unpacked.manifest)
})

test('all four official ZIPs are identical to standalone toolkit repacks and named example copies', { timeout: 120000 }, async t => {
  const { directory, run } = await isolatedKit(t)
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'plugins/store/catalog.json'), 'utf8'))
  const index = JSON.parse(await fs.readFile(path.join(root, 'plugins/development-examples/index.json'), 'utf8'))
  assert.equal(catalog.plugins.length, 4)
  assert.equal(index.plugins.length, 4)
  for (const plugin of catalog.plugins) {
    await t.test(plugin.id, async() => {
      const original = await fs.readFile(path.join(root, 'plugins/store', plugin.path))
      const example = index.plugins.find(item => item.id === plugin.id)
      assert.equal(example.sha256, hash(original))
      assert.deepEqual(await fs.readFile(path.join(root, 'plugins/development-examples', example.file)), original)
      const source = path.join(directory, plugin.id)
      const input = path.join(directory, plugin.id + '-original.zip')
      await fs.writeFile(input, original)
      await run('unpack', input, source)
      await run('pack', source)
      const rebuilt = await fs.readFile(source + '.zip')
      assert.equal(hash(rebuilt), hash(original), 'Standalone repacking must reproduce every original byte')
      const { manifest, files } = await unpackSource(rebuilt)
      assert.equal(manifest.devkit.version, '1.0.0')
      assert.ok(files.has('DEVELOPMENT.md'))
      assert.ok(files.has('types/lx-m-plugin.d.ts'))
    })
  }
})

test('toolkit interface declarations match the host API', async() => {
  const ts = require('typescript')
  const interfaces = text => {
    const result = new Map()
    const visit = node => {
      if (ts.isInterfaceDeclaration(node)) result.set(node.name.text, node.getText().replace(/\s+/g, ''))
      ts.forEachChild(node, visit)
    }
    visit(ts.createSourceFile('types.ts', text, ts.ScriptTarget.Latest, true))
    return result
  }
  const host = interfaces(await fs.readFile(path.join(root, 'src/common/optionalPluginTypes.ts'), 'utf8'))
  const kit = interfaces(await fs.readFile(path.join(root, 'plugins/developer-kit/types/lx-m-plugin.d.ts'), 'utf8'))
  assert.deepEqual(kit, host)
})
