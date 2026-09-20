const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { packFiles, readTree } = require('./developer-kit/project.cjs')
const { dependencyFiles } = require('./developer-kit/dependencies.cjs')
const root = path.resolve(__dirname, '../..')

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
  files.set('README.md', Buffer.from(`# ${id} ${spec.version}\n\n这是使用 LX-M 插件开发工具包统一打包的源码插件，可独立编辑和重新打包。\n\n在支持源码插件的 LX-M 中打开「设置 → 插件商店 → 导入插件」，选择本 ZIP。软件使用内置编译器离线编译并加载，安装使用者无需另装 Node.js。\n\n修改与打包方法见 DEVELOPMENT.md；使用独立工具包的 node lx-plugin.cjs pack <目录> <输出.zip>，不需要主程序仓库。\n\n源码在 src/，辅助源码在 sdk/，锁定的离线依赖在 vendor/。请保留 LICENSE、NOTICE 和第三方依赖许可证。\n导出时保留源码，个人设置单独保存在本机。\n`))
  const { dependencies, ...manifest } = spec
  return packFiles({ ...manifest, ...display, assets }, files)
}

module.exports.readTree = readTree
