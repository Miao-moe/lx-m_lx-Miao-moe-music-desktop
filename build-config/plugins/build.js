process.env.NODE_ENV = 'production'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const base = require('../renderer/webpack.config.base')
const buildSourcePackage = require('./source-package.cjs')
const buildCompiledPackage = require('./compiled-package.cjs')
const { writeOutput, version: devkitVersion } = require('./developer-kit/project.cjs')
const { validPath } = require('../../src/common/pluginSource')

const root = path.resolve(__dirname, '../..')
const outputRoot = path.join(root, 'build/optional-plugins')
const catalogRoot = path.join(root, 'plugins/store')
const sourceRoot = path.join(root, 'src/optional-plugins')
const sha256 = data => createHash('sha256').update(data).digest('hex')
const writeArchive = async(filename, bytes) => {
  const existing = await fs.readFile(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (existing) {
    if (!existing.equals(bytes)) throw new Error('Existing plugin package checksum mismatch: ' + filename)
    return
  }
  await fs.writeFile(filename, bytes, { flag: 'wx' })
}
const externals = require('../../src/main/pluginCompiler/host.cjs')

const compile = config => new Promise((resolve, reject) => {
  const compiler = webpack(config)
  compiler.run((error, stats) => {
    compiler.close(() => {
      if (error) reject(error)
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      else resolve(stats)
    })
  })
})

async function main() {
  const sources = new Map()
  for (const directory of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const source = path.join(sourceRoot, directory.name)
    const sourceText = await fs.readFile(path.join(source, 'plugin.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!sourceText) continue
    const manifest = JSON.parse(sourceText)
    if (manifest.id !== directory.name || directory.name.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(directory.name) || /^(constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(directory.name)) throw new Error('Invalid plugin source directory')
    const store = JSON.parse(await fs.readFile(path.join(source, 'store.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '{}' }))
    const display = { name: store.name ?? manifest.name, description: store.description ?? manifest.description, icon: store.icon ?? manifest.icon }
    sources.set(directory.name, { source, manifest, display })
  }
  const ids = [...sources.keys()]
  const requested = process.argv.slice(2)
  if (requested.some(id => !ids.includes(id))) throw new Error('Unknown plugin ID')
  const selected = requested.length ? ids.filter(id => requested.includes(id)) : ids
  const catalogFile = path.join(catalogRoot, 'catalog.json')
  const previousCatalog = await fs.readFile(catalogFile, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '{"schemaVersion":2,"plugins":[]}' })
  const order = new Map([...new Set([...JSON.parse(previousCatalog).plugins.map(plugin => plugin.id), ...ids])].map((id, index) => [id, index]))
  const catalog = requested.length ? JSON.parse(previousCatalog) : { schemaVersion: 2, plugins: [] }
  catalog.plugins = catalog.plugins.filter(plugin => !selected.includes(plugin.id))
  for (const id of selected) {
    const { source, manifest: originalManifest, display } = sources.get(id)
    const manifest = { ...originalManifest, ...display }
    if (manifest.format !== 'lx-m-plugin-source' || manifest.formatVersion !== 1 || manifest.id !== id || typeof manifest.version !== 'string' || !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(manifest.version) || !Number.isSafeInteger(manifest.apiVersion) || manifest.apiVersion < 1) throw new Error('Invalid plugin manifest')
    const output = path.resolve(outputRoot, id)
    if (!output.startsWith(outputRoot + path.sep)) throw new Error('Unsafe plugin build output')
    await fs.rm(output, { recursive: true, force: true })
    const sourceEntry = name => {
      if (!validPath(name) || !name.startsWith('src/')) throw new Error('Invalid plugin source entry')
      return path.join(source, name.slice(4))
    }
    const entry = { renderer: sourceEntry(manifest.entry) }
    if (manifest.lyricEntry) entry.lyric = sourceEntry(manifest.lyricEntry)
    const stats = await compile({
      ...base,
      context: root,
      mode: 'production',
      entry,
      devtool: false,
      output: { path: output, filename: '[name].js', publicPath: '', library: { type: 'commonjs2' } },
      externalsType: 'var',
      externals,
      module: {
        ...base.module,
        rules: [...base.module.rules.map(rule => rule.test?.test('entry.ts') ? {
          ...rule,
          use: { loader: 'ts-loader', options: { appendTsSuffixTo: [/\.vue$/], configFile: path.join(root, 'src/optional-plugins/tsconfig.json'), transpileOnly: true } },
        } : rule), {
          test: /audiomotion-analyzer[\\/]src[\\/]audioMotion-analyzer\.js$/,
          use: path.join(__dirname, 'audiomotion-loader.js'),
        }],
      },
      optimization: { minimize: false, splitChunks: false, runtimeChunk: false },
      plugins: [
        new VueLoaderPlugin(),
        new MiniCssExtractPlugin({ filename: '[name].css' }),
        new webpack.DefinePlugin({ __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }),
        // Resolve the SDK source graph without emitting precompiled plugin bundles.
        { apply(compiler) { compiler.hooks.shouldEmit.tap('SourcePackageOnly', () => false) } },
      ],
      node: { __dirname: false, __filename: false },
    })
    await fs.mkdir(output, { recursive: true })
    if (id === 'audio-visualizer') {
      const licenses = path.join(output, 'licenses')
      await fs.mkdir(licenses, { recursive: true })
      await fs.copyFile(path.join(root, 'node_modules/audiomotion-analyzer/LICENSE'), path.join(licenses, 'audioMotion-AGPL-3.0.txt'))
      await fs.copyFile(path.join(source, 'NOTICE.md'), path.join(output, 'NOTICE.md'))
    }
    if (id === 'audio-tag-editor') {
      const licenses = path.join(output, 'licenses')
      await fs.mkdir(licenses, { recursive: true })
      for (const name of ['node-id3', 'iconv-lite', 'safer-buffer']) {
        await fs.copyFile(path.join(root, 'node_modules', name, 'LICENSE'), path.join(licenses, `${name}-MIT.txt`))
      }
      await fs.copyFile(path.join(source, 'NOTICE.md'), path.join(output, 'NOTICE.md'))
    }
    if (id === 'folia-lyrics') {
      await fs.copyFile(path.join(source, 'NOTICE.md'), path.join(output, 'NOTICE.md'))
      await fs.copyFile(path.join(source, 'engine/vendor/LICENSE'), path.join(output, 'LICENSE'))
      const lock = JSON.parse(await fs.readFile(path.join(source, 'engine/package-lock.json'), 'utf8'))
      const notices = []
      for (const [name, info] of Object.entries(lock.packages)) {
        if (!name.startsWith('node_modules/')) continue
        const directory = path.join(source, 'engine', name)
        let names
        try { names = await fs.readdir(directory) } catch (error) {
          if (error.code === 'ENOENT' && info.optional) continue
          throw error
        }
        const licenseNames = names.filter(name => /^(license|licence|copying|notice)([.-]|$)/i.test(name))
        const texts = []
        for (const name of licenseNames) {
          if ((await fs.stat(path.join(directory, name))).isFile()) texts.push(await fs.readFile(path.join(directory, name), 'utf8'))
        }
        notices.push(`${name.replace(/^node_modules\//, '')} ${info.version}\n${texts.join('\n') || `License: ${info.license ?? 'See package metadata'}`}\n`)
      }
      await fs.mkdir(path.join(output, 'licenses'), { recursive: true })
      await fs.writeFile(path.join(output, 'licenses/THIRD-PARTY.txt'), notices.join('\n========================================\n\n'))
    }
    const sourceArchive = await buildSourcePackage({ id, source, display, output, stats })
    const sourceHash = sha256(sourceArchive)
    const sourceRelative = `${id}/${manifest.version}/${sourceHash}.zip`
    await fs.mkdir(path.dirname(path.join(catalogRoot, sourceRelative)), { recursive: true })
    await writeArchive(path.join(catalogRoot, sourceRelative), sourceArchive)
    const compiledArchive = await buildCompiledPackage(sourceArchive)
    const compiledHash = sha256(compiledArchive)
    const compiledRelative = `${id}/${manifest.version}/${compiledHash}.lxplugin`
    await writeArchive(path.join(catalogRoot, compiledRelative), compiledArchive)
    // Keep the primary ZIP fields readable by source-only clients; newer clients prefer packages.lxplugin.
    catalog.plugins.push({ id, version: manifest.version, apiVersion: manifest.apiVersion, path: sourceRelative, bytes: sourceArchive.length, sha256: sourceHash, packages: { lxplugin: { path: compiledRelative, bytes: compiledArchive.length, sha256: compiledHash } }, ...display })
    console.log(`Packaged ${id} ${manifest.version}: LXPlugin ${compiledArchive.length} bytes, source ZIP ${sourceArchive.length} bytes`)
  }
  for (const plugin of catalog.plugins) Object.assign(plugin, sources.get(plugin.id)?.display ?? {})
  catalog.plugins.sort((a, b) => order.get(a.id) - order.get(b.id))
  await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
  const examples = path.join(root, 'plugins/development-examples')
  const examplesIndex = { schemaVersion: 1, devkitVersion, plugins: [] }
  for (const plugin of catalog.plugins) {
    if (!sources.has(plugin.id) || !validPath(plugin.path)) throw new Error('Invalid development example')
    const bytes = await fs.readFile(path.join(catalogRoot, plugin.path))
    if (sha256(bytes) !== plugin.sha256 || bytes.length !== plugin.bytes) throw new Error('Development example checksum mismatch')
    const filename = `${plugin.id}-${plugin.version}.zip`
    if (!validPath(filename)) throw new Error('Invalid development example filename')
    await writeOutput(path.join(examples, filename), bytes)
    examplesIndex.plugins.push({ id: plugin.id, version: plugin.version, file: filename, bytes: bytes.length, sha256: plugin.sha256 })
  }
  await writeOutput(path.join(examples, 'index.json'), Buffer.from(JSON.stringify(examplesIndex, null, 2) + '\n'))
  console.log('Plugin catalog written to plugins/store/catalog.json')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
