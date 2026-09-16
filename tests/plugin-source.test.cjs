const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { fork, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { runInNewContext } = require('node:vm')
const { test } = require('node:test')
const { packSource, unpackSource, readZip, writeZip, validPath } = require('../src/common/pluginSource')

const source = (id = 'source-example') => ({ id, version: '1.0.0', apiVersion: 3, entry: 'src/index.ts' })
const minimal = () => new Map([['src/index.ts', Buffer.from('export default { components: {} }')]])

test('source ZIPs contain original files and accept one enclosing folder', async() => {
  const files = minimal()
  files.set('src/说明.txt', Buffer.from('Unicode resource'))
  const bytes = await packSource(source(), files)
  assert.equal(bytes.subarray(0, 2).toString(), 'PK')
  const unpacked = await unpackSource(bytes)
  assert.deepEqual(unpacked.files, files)
  assert.equal(unpacked.manifest.format, 'lx-m-plugin-source')
  const wrapped = new Map([...(await readZip(bytes))].map(([name, value]) => ['source-example/' + name, value]))
  assert.deepEqual((await unpackSource(await writeZip(wrapped))).files, files)
})

test('source manifests reject unsafe paths, missing entries, conflicting paths and modified content', async() => {
  for (const name of ['../escape', '/root', 'C:/file', 'bad\\file', 'file:stream', 'folder./a', 'NUL.txt', 'folder/../a']) assert.equal(validPath(name), false, name)
  for (const patch of [{ id: 'constructor' }, { version: ['1.0.0'] }, { apiVersion: 0 }, { entry: '../index.ts' }, { entry: 'src/missing.ts' }, { browser: { entry: 'src/index.ts', output: '../escape' } }, { assets: [{ from: 'src', to: 'renderer.js' }] }]) {
    await assert.rejects(packSource({ ...source(), ...patch }, minimal()))
  }
  const archive = await readZip(await packSource(source(), minimal()))
  archive.set('src/index.ts', Buffer.from('modified'))
  await assert.rejects(unpackSource(await writeZip(archive)), /checksum/)
  archive.set('extra.js', Buffer.from('unlisted'))
  await assert.rejects(unpackSource(await writeZip(archive)), /manifest/)
  const files = minimal()
  files.set('src/index.ts/nested.js', Buffer.alloc(0))
  await assert.rejects(packSource(source(), files), /conflict/)
})

test('ZIP CRC, symlink metadata and duplicate entry names are checked before compilation', async() => {
  const bytes = await packSource(source(), minimal())
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  const badCrc = Buffer.from(bytes)
  badCrc.writeUInt32LE((badCrc.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16)
  await assert.rejects(unpackSource(badCrc), /checksum/)
  const link = Buffer.from(bytes)
  link.writeUInt32LE((0xa1ff << 16) >>> 0, central + 38)
  await assert.rejects(unpackSource(link), /entry/)
  const duplicate = new Map([['src/index.ts', Buffer.from('one')], ['SRC/INDEX.TS', Buffer.from('two')]])
  await assert.rejects(readZip(await writeZip(duplicate)), /entry/)
  const conflict = await readZip(bytes)
  conflict.set('plugin.json/extra.ts', Buffer.from('conflict'))
  await assert.rejects(readZip(await writeZip(conflict)), /conflict/)
})

test('the author tool packs the template and preserves nested vendor dependencies when repacking', async() => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-source-repack-'))
  try {
    const source = path.join(temporary, 'source')
    const output = path.join(temporary, 'plugin.zip')
    await fs.cp(path.resolve('plugins/template'), source, { recursive: true })
    const nested = 'vendor/main/example/node_modules/nested/package.json'
    await fs.mkdir(path.dirname(path.join(source, nested)), { recursive: true })
    await fs.writeFile(path.join(source, nested), '{"name":"nested","version":"1.0.0"}')
    await fs.mkdir(path.join(source, 'node_modules/unwanted'), { recursive: true })
    await fs.writeFile(path.join(source, 'node_modules/unwanted/index.js'), 'not a bundled dependency')
    await fs.writeFile(path.join(source, '.env'), 'LOCAL_SETTING=excluded')
    await promisify(execFile)(process.execPath, [path.resolve('build-config/plugins/pack-source.cjs'), source, output], { windowsHide: true })
    const unpacked = await unpackSource(await fs.readFile(output))
    assert.equal(unpacked.files.has(nested), true)
    assert.equal(unpacked.files.has('src/Settings.vue'), true)
    assert.equal(unpacked.files.has('node_modules/unwanted/index.js'), false)
    assert.equal(unpacked.files.has('.env'), false)
    await assert.rejects(promisify(execFile)(process.execPath, [path.resolve('build-config/plugins/pack-source.cjs'), source, path.join(source, 'plugin.zip')], { windowsHide: true }))
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(), 'lx-source-repack-')))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

const compile = (worker, source, output, manifest) => new Promise((resolve, reject) => {
  const child = fork(worker, [], { cwd: source, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  let result
  let log = ''
  const timeout = setTimeout(() => child.kill(), 180000)
  child.stdout.on('data', data => { log = (log + data).slice(-1000) })
  child.stderr.on('data', data => { log = (log + data).slice(-6000) })
  child.on('message', value => { result = value })
  child.on('error', reject)
  child.on('exit', code => { clearTimeout(timeout); if (code === 0 && result?.success) resolve(); else reject(new Error(result?.message ?? log)) })
  child.send({ source, output, manifest })
})

test('the bundled compiler rebuilds all four source ZIPs outside the repository without development dependencies', { timeout: 240000 }, async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-source-compiler-'))
  const catalog = require('../plugins/store/catalog.json')
  try {
    const compiler = path.join(temporary, 'app.asar.unpacked/dist/plugin-compiler')
    const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher')
    const filters = []
    for (const filename of ['build-config/build-pack.js', 'build-config/build-pack-newdir.js']) {
      // Use the installer's real file filters, without starting an installer build.
      const text = await fs.readFile(filename, 'utf8')
      const files = runInNewContext(text.match(/files:\s*(\[[\s\S]*?\])/)[1])
      const info = { projectDir: process.cwd(), buildResourcesDir: 'resources', config: { files }, debugLogger: { isEnabled: false } }
      const [matcher] = getMainFileMatchers(process.cwd(), compiler, value => value, {}, { info }, temporary, false)
      filters.push(matcher.createFilter())
    }
    await fs.cp(path.resolve('dist/plugin-compiler'), compiler, {
      recursive: true,
      filter: async filename => {
        const stat = await fs.lstat(filename)
        const included = filters.map(filter => filter(filename, stat))
        assert.equal(included[0], included[1], 'Both installer configurations must ship the same compiler files')
        return included[0]
      },
    })
    for (const plugin of catalog.plugins) {
      await t.test(plugin.id, async() => {
        const sourcePackage = await unpackSource(await fs.readFile(path.join('plugins/store', plugin.path)))
        assert.equal(sourcePackage.manifest.id, plugin.id)
        assert.equal(sourcePackage.files.has('src/index.ts'), true)
        assert.equal(sourcePackage.files.has('renderer.js'), false)
        assert.equal(sourcePackage.files.has('dist/renderer.js'), false)
        const source = path.join(temporary, plugin.id, 'input')
        const output = path.join(temporary, plugin.id, 'output')
        const entries = [...sourcePackage.files]
        for (let index = 0; index < entries.length; index += 32) {
          await Promise.all(entries.slice(index, index + 32).map(async([name, data]) => {
            const filename = path.join(source, name)
            await fs.mkdir(path.dirname(filename), { recursive: true })
            await fs.writeFile(filename, data)
          }))
        }
        await compile(path.join(compiler, 'worker.cjs'), source, output, sourcePackage.manifest)
        assert.ok((await fs.stat(path.join(output, 'renderer.js'))).size > 0)
        assert.ok((await fs.stat(path.join(output, 'renderer.css'))).size > 0)
        if (plugin.id === 'folia-lyrics') assert.ok((await fs.stat(path.join(output, 'engine/engine.js'))).size > 0)
        if (plugin.id === 'audio-visualizer') assert.ok((await fs.stat(path.join(output, 'lyric.js'))).size > 0)
      })
    }
    await t.test('Folia compiles when the host has no matching native CSS or scanner binaries', async() => {
      const wasmCompiler = path.join(temporary, 'wasm-compiler')
      await fs.cp(compiler, wasmCompiler, { recursive: true, filter: filename => !filename.endsWith('.node') })
      const plugin = catalog.plugins.find(plugin => plugin.id === 'folia-lyrics')
      const { manifest } = await unpackSource(await fs.readFile(path.join('plugins/store', plugin.path)))
      const output = path.join(temporary, 'folia-wasm-output')
      await compile(path.join(wasmCompiler, 'worker.cjs'), path.join(temporary, plugin.id, 'input'), output, manifest)
      assert.ok((await fs.stat(path.join(output, 'engine/engine.js'))).size > 0)
      assert.ok((await fs.stat(path.join(output, 'engine/engine.css'))).size > 0)
    })
  } catch (error) {
    console.error('Source compiler work directory:', temporary)
    throw error
  } finally {
    assert.ok(path.resolve(temporary).startsWith(path.join(os.tmpdir(), 'lx-source-compiler-')))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
