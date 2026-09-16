const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { createHash } = require('node:crypto')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'dist/plugin-compiler')
const dependencies = ['webpack', 'typescript', 'ts-loader', 'vue-loader', 'vue', 'css-loader', 'less-loader', 'less', 'mini-css-extract-plugin', 'pug', 'pug-plain-loader', 'postcss', 'postcss-loader', 'postcss-pxtorem', '@tailwindcss/postcss', 'lightningcss-wasm']

// npm omits this optional package on native CPUs. Ship its locked WASM build,
// including bundled JS dependencies, so imports also work on x86 and ARM64.
const stageWasmScanner = async() => {
  const name = '@tailwindcss/oxide-wasm32-wasi'
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')).packages['node_modules/' + name]
  if (!lock?.resolved?.startsWith('https://registry.npmjs.org/') || !lock.integrity?.startsWith('sha512-')) throw new Error('Missing locked WASM scanner dependency')
  const cache = path.join(root, 'build/compiler-cache')
  const archive = path.join(cache, createHash('sha256').update(lock.integrity).digest('hex') + '.tgz')
  const valid = data => 'sha512-' + createHash('sha512').update(data).digest('base64') === lock.integrity
  let data = await fs.readFile(archive).catch(() => null)
  if (!data || !valid(data)) {
    const response = await fetch(lock.resolved, { signal: AbortSignal.timeout(60000) })
    if (!response.ok) throw new Error('Cannot download the locked WASM scanner: ' + response.status)
    data = Buffer.from(await response.arrayBuffer())
    if (!valid(data)) throw new Error('WASM scanner integrity check failed')
    await fs.mkdir(cache, { recursive: true })
    await fs.writeFile(archive, data)
  }
  const target = path.join(output, 'node_modules', name)
  await fs.mkdir(target, { recursive: true })
  await require('tar').x({ file: archive, cwd: target, strip: 1, strict: true })
  const loader = path.join(target, 'tailwindcss-oxide.wasi.cjs')
  const original = await fs.readFile(loader, 'utf8')
  // The scanner needs 983 initial pages. A 1 GiB reservation prevents its
  // worker threads from starting in 32-bit Electron's address space.
  if (!original.includes('initial: 16384,') || !original.includes('maximum: 65536,')) throw new Error('Unexpected WASM scanner memory configuration')
  await fs.writeFile(loader, original
    .replace('initial: 16384,', "initial: process.arch === 'ia32' ? 1024 : 16384,")
    .replace('maximum: 65536,', "maximum: process.arch === 'ia32' ? 8192 : 65536,"))
}

const packageDirectory = (name, from) => {
  const resolve = createRequire(path.join(from, 'package.json')).resolve
  try { return path.dirname(resolve(name + '/package.json')) } catch {
    let directory = path.dirname(resolve(name))
    while (directory !== path.dirname(directory)) {
      try { if (require(path.join(directory, 'package.json')).name === name) return directory } catch {}
      directory = path.dirname(directory)
    }
    throw new Error('Cannot locate dependency: ' + name)
  }
}

const stageCompiler = async() => {
  await fs.mkdir(output, { recursive: true })
  await fs.cp(path.join(root, 'src/main/pluginCompiler'), output, { recursive: true })
  const signature = createHash('sha256').update(await fs.readFile(path.join(root, 'package-lock.json'))).update(await fs.readFile(__filename)).update(process.platform + ':' + process.arch).digest('hex')
  const marker = path.join(output, 'dependencies.sha256')
  if (await fs.readFile(marker, 'utf8').catch(() => '') === signature) return
  const modules = path.resolve(output, 'node_modules')
  if (path.dirname(modules) !== output) throw new Error('Invalid compiler staging path')
  await fs.rm(modules, { recursive: true, force: true })
  const visited = new Set()
  const copy = async(name, from, optional = false) => {
    let directory
    try { directory = packageDirectory(name, from) } catch (error) { if (optional) return; throw error }
    if (visited.has(directory)) return
    visited.add(directory)
    const relative = path.relative(path.join(root, 'node_modules'), directory)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Compiler dependency is outside node_modules')
    const target = path.join(modules, relative)
    await fs.cp(directory, target, { recursive: true, filter: filename => filename === directory || path.basename(filename) !== 'node_modules' })
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    for (const dependency of Object.keys(info.dependencies ?? {})) await copy(dependency, directory, !!info.optionalDependencies?.[dependency])
    for (const dependency of Object.keys(info.optionalDependencies ?? {})) await copy(dependency, directory, true)
  }
  for (const dependency of dependencies) await copy(dependency, root)
  await stageWasmScanner()
  await fs.writeFile(marker, signature)
  console.log(`Plugin compiler staged (${visited.size} dependencies)`)
}

module.exports = { stageCompiler, packageDirectory }
if (require.main === module) stageCompiler().catch(error => { console.error(error); process.exitCode = 1 })
