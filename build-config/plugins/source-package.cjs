const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { packSource } = require('../../src/common/pluginSource')
const { packageDirectory } = require('./stage-compiler.cjs')
const root = path.resolve(__dirname, '../..')

const readTree = async(directory, prefix, files, filter = () => true) => {
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (item.isSymbolicLink()) throw new Error('Source packages cannot include symbolic links')
    if (!filter(item.name, item.isDirectory(), prefix + item.name)) continue
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) await readTree(filename, prefix + item.name + '/', files, filter)
    else files.set(prefix + item.name, await fs.readFile(filename))
  }
}

const dependencyFiles = async(dependencies, from, prefix, files) => {
  const modules = path.join(from, 'node_modules')
  const visited = new Set()
  const versions = {}
  const copy = async(name, parent, optional = false) => {
    let directory
    try { directory = packageDirectory(name, parent) } catch (error) { if (optional) return; throw error }
    if (visited.has(directory)) return
    visited.add(directory)
    const relative = path.relative(modules, directory).replaceAll('\\', '/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Source dependency must be installed in its workspace: ' + name)
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    versions[relative] = { name: info.name, version: info.version, license: info.license ?? null }
    await readTree(directory, prefix + relative + '/', files, (name, directory) => directory
      ? !['node_modules', '.git', 'test', 'tests', '__tests__', 'coverage', '.github'].includes(name)
      : !name.endsWith('.map') && !/\.d\.[cm]?ts$/.test(name) && !/^\.env(?:\.|$)/.test(name))
    for (const dependency of Object.keys(info.dependencies ?? {})) await copy(dependency, directory, !!info.optionalDependencies?.[dependency])
    for (const dependency of Object.keys(info.optionalDependencies ?? {})) await copy(dependency, directory, true)
  }
  for (const [name, version] of Object.entries(dependencies)) {
    const directory = packageDirectory(name, from)
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    if (info.version !== version) throw new Error(`Expected ${name}@${version}, got ${info.version}`)
    await copy(name, from)
  }
  files.set(prefix + 'dependencies.json', Buffer.from(JSON.stringify(versions, null, 2) + '\n'))
}

module.exports = async({ id, source, display, output, stats }) => {
  const spec = JSON.parse(await fs.readFile(path.join(source, 'plugin.json'), 'utf8'))
  if (spec.id !== id) throw new Error('Plugin source ID does not match its directory')
  const files = new Map()
  await readTree(source, 'src/', files, (name, directory, relative) => directory
    ? !['node_modules', '.git', 'dist', 'build'].includes(name)
    : !['src/plugin.json', 'src/manifest.json', 'src/store.json'].includes(relative) && !/^\.env(?:\.|$)/.test(name))
  // Carry the host helpers actually bundled by the plugin, keeping their original relative imports.
  for (const filename of stats.compilation.fileDependencies) {
    if (!filename.startsWith(path.join(root, 'src') + path.sep) || filename.startsWith(source + path.sep)) continue
    const stat = await fs.lstat(filename).catch(() => null)
    if (!stat?.isFile()) continue
    files.set('sdk/' + path.relative(path.join(root, 'src'), filename).replaceAll('\\', '/'), await fs.readFile(filename))
  }
  await dependencyFiles(spec.dependencies ?? {}, root, 'vendor/main/', files)
  if (spec.browser) {
    const engine = path.join(source, 'engine')
    const info = JSON.parse(await fs.readFile(path.join(engine, 'package.json'), 'utf8'))
    await dependencyFiles(info.dependencies, engine, 'vendor/engine/', files)
  }
  // These are source-level host adaptations, not precompiled bundles.
  if (id === 'sound-effects') {
    const filename = 'src/pitch-shifter/phase-vocoder.js'
    files.set(filename, Buffer.from(files.get(filename).toString().replace("from './fft'", "from './fft.js'").replace("from './ola-processor'", "from './ola-processor.js'").replaceAll('phase-vocoder-processor', `lx-sound-effects-${spec.version}`)))
  }
  if (id === 'audio-visualizer') {
    const filename = 'vendor/main/audiomotion-analyzer/src/audioMotion-analyzer.js'
    files.set(filename, Buffer.from(require('./audiomotion-loader')(files.get(filename).toString())))
  }
  if (id === 'folia-lyrics') {
    const { patchPausedFumeCamera } = await import(pathToFileURL(path.join(source, 'engine/adapters/pausedCamera.mjs')).href)
    const filename = 'src/engine/vendor/src/components/visualizer/fume/VisualizerFume.tsx'
    files.set(filename, Buffer.from(patchPausedFumeCamera(files.get(filename).toString())))
  }
  const assets = [...(spec.assets ?? [])]
  if (await fs.stat(path.join(output, 'licenses')).catch(() => null)) {
    await readTree(path.join(output, 'licenses'), 'src/licenses/', files)
    assets.push({ from: 'src/licenses', to: 'licenses' })
  }
  for (const name of ['LICENSE', 'NOTICE.md']) {
    const data = await fs.readFile(path.join(output, name)).catch(() => null)
    if (data) { files.set('src/' + name, data); files.set(name, data); assets.push({ from: 'src/' + name, to: name }) }
  }
  if (!files.has('LICENSE')) files.set('LICENSE', await fs.readFile(path.join(root, 'LICENSE')))
  files.set('README.md', Buffer.from(`# ${id} ${spec.version}\n\n这是 LX-M 纯源码插件包，不含 renderer.js、lyric.js 或预编译引擎。\n\n在支持源码插件的 LX-M 中打开「设置 → 插件商店 → 导入插件」，选择本 ZIP。软件使用内置编译器编译 Vue/TypeScript、样式和浏览器引擎，成功后立即加载，无需另装 Node.js。\n\n- plugin.json：版本、接口、源码入口、资源和文件校验清单。\n- src/：插件源码和原始资源。\n- sdk/：此插件使用的宿主组件源码；播放器等接口由运行中的软件提供。\n- vendor/：锁定版本的第三方依赖代码和许可证，支持离线编译。\n\n修改源码后，使用 LX-M 仓库的 node build-config/plugins/pack-source.cjs <目录> <输出.zip> 重新生成校验清单和 ZIP，再导入。\n导出时将保留的源码重新打包为 ZIP，个人设置单独保存在本机。\n`))
  const { dependencies, ...manifest } = spec
  return packSource({ ...manifest, ...display, assets }, files)
}

module.exports.readTree = readTree
