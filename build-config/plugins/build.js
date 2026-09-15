process.env.NODE_ENV = 'production'

const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { gzipSync } = require('node:zlib')
const { execFileSync } = require('node:child_process')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const base = require('../renderer/webpack.config.base')

const root = path.resolve(__dirname, '../..')
const outputRoot = path.join(root, 'build/optional-plugins')
const catalogRoot = path.join(root, 'plugins/official')
const sourceRoot = path.join(root, 'src/optional-plugins')
// Only these IDs are understood by already released hosts using catalog.json.
const legacyIds = ['sound-effects', 'audio-visualizer']
const sha256 = data => createHash('sha256').update(data).digest('hex')
const externals = Object.fromEntries(Object.entries({
  vue: 'vue',
  '@common/utils/vueTools': 'vue',
  '@renderer/plugins/player': 'player',
  '@renderer/store/setting': 'settings',
  '@renderer/store/player/state': 'playerState',
  '@renderer/store/player/lyric': 'mainLyricState',
  '@renderer/store/player/playProgress': 'playProgress',
  '@renderer/utils/ipc': 'ipc',
  '@renderer/plugins/Dialog': 'dialog',
  '@renderer/core/lyric': 'lyric',
  '@lyric/store/state': 'lyricState',
  '@lyric/core/mainWindowChannel': 'lyricChannel',
}).map(([name, value]) => [name, 'window.__lxPluginHost.' + value]))

const compile = config => new Promise((resolve, reject) => {
  const compiler = webpack(config)
  compiler.run((error, stats) => {
    compiler.close(() => {
      if (error) reject(error)
      else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true, errorDetails: true })))
      else resolve()
    })
  })
})

const readFiles = async(directory, prefix = '') => {
  const files = []
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = prefix + entry.name
    if (entry.isDirectory()) files.push(...await readFiles(path.join(directory, entry.name), name + '/'))
    else files.push({ path: name, data: await fs.readFile(path.join(directory, entry.name)) })
  }
  return files
}

async function main() {
  const sources = new Map()
  for (const directory of await fs.readdir(sourceRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue
    const source = path.join(sourceRoot, directory.name)
    const manifestText = await fs.readFile(path.join(source, 'manifest.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error })
    if (!manifestText) continue
    const manifest = JSON.parse(manifestText)
    if (manifest.id !== directory.name || directory.name.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(directory.name) || /^(constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(directory.name)) throw new Error('Invalid plugin source directory')
    const store = JSON.parse(await fs.readFile(path.join(source, 'store.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return '{}' }))
    const display = { name: store.name ?? manifest.name, description: store.description ?? manifest.description, icon: store.icon ?? manifest.icon }
    sources.set(directory.name, { source, manifest, display })
  }
  const ids = [...sources.keys()]
  const requested = process.argv.slice(2)
  if (requested.some(id => !ids.includes(id))) throw new Error('Unknown plugin ID')
  const selected = requested.length ? ids.filter(id => requested.includes(id)) : ids
  const catalogFile = path.join(catalogRoot, 'catalog-v2.json')
  const previousCatalog = await fs.readFile(catalogFile, 'utf8').catch(() => fs.readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'))
  const order = new Map([...new Set([...JSON.parse(previousCatalog).plugins.map(plugin => plugin.id), ...ids])].map((id, index) => [id, index]))
  const catalog = requested.length ? JSON.parse(previousCatalog) : { schemaVersion: 1, plugins: [] }
  catalog.plugins = catalog.plugins.filter(plugin => !selected.includes(plugin.id))
  for (const id of selected) {
    const { source, manifest: originalManifest, display } = sources.get(id)
    const manifest = { ...originalManifest, ...display }
    if (manifest.id !== id || !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(manifest.version) || !Number.isSafeInteger(manifest.apiVersion) || manifest.apiVersion < 1) throw new Error('Invalid plugin manifest')
    const output = path.resolve(outputRoot, id)
    if (!output.startsWith(outputRoot + path.sep)) throw new Error('Unsafe plugin build output')
    await fs.rm(output, { recursive: true, force: true })
    const entry = { renderer: path.join(source, 'index.ts') }
    if (manifest.lyricEntry) entry.lyric = path.join(source, 'lyric.ts')
    await compile({
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
      optimization: { minimize: true, splitChunks: false, runtimeChunk: false },
      plugins: [
        new VueLoaderPlugin(),
        new MiniCssExtractPlugin({ filename: '[name].css' }),
        new webpack.DefinePlugin({ __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' }),
      ],
      node: { __dirname: false, __filename: false },
    })
    if (id === 'sound-effects') {
      await fs.cp(path.join(source, 'filters'), path.join(output, 'filters'), { recursive: true })
      await fs.cp(path.join(source, 'pitch-shifter'), path.join(output, 'pitch-shifter'), { recursive: true })
      const workletPath = path.join(output, 'pitch-shifter/phase-vocoder.js')
      const worklet = (await fs.readFile(workletPath, 'utf8')).replace("from './fft'", "from './fft.js'").replace("from './ola-processor'", "from './ola-processor.js'").replaceAll('phase-vocoder-processor', `lx-sound-effects-${manifest.version}`)
      await fs.writeFile(workletPath, worklet)
    }
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
      execFileSync(process.execPath, [path.join(source, 'engine/build.mjs')], { cwd: root, stdio: 'inherit' })
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
      // Include the corresponding source and locked dependencies with the plugin.
      execFileSync('tar', ['-czf', path.join(output, 'source.tar.gz'), '--exclude=node_modules', '-C', source, '.'], { cwd: root })
    }
    const files = await readFiles(output)
    manifest.files = files.map(file => ({ path: file.path, bytes: file.data.length, sha256: sha256(file.data) }))
    const archive = gzipSync(Buffer.from(JSON.stringify({ manifest, files: Object.fromEntries(files.map(file => [file.path, file.data.toString('base64')])) })), { level: 9 })
    const hash = sha256(archive)
    const relative = `${id}/${manifest.version}/${hash}.lxplugin`
    const filename = path.join(catalogRoot, relative)
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, archive)
    catalog.plugins.push({ id, version: manifest.version, apiVersion: manifest.apiVersion, path: relative, bytes: archive.length, sha256: hash, ...display })
    console.log(`Built ${id} ${manifest.version}: ${archive.length} bytes`)
  }
  for (const plugin of catalog.plugins) Object.assign(plugin, sources.get(plugin.id)?.display ?? {})
  catalog.plugins.sort((a, b) => order.get(a.id) - order.get(b.id))
  await fs.writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n')
  // Older hosts reject unknown IDs; keep their catalog usable for API 1 plugins.
  const legacyPlugins = catalog.plugins.filter(plugin => legacyIds.includes(plugin.id) && plugin.apiVersion === 1)
    .sort((a, b) => legacyIds.indexOf(a.id) - legacyIds.indexOf(b.id))
    .map(({ id, version, apiVersion, path, bytes, sha256 }) => ({ id, version, apiVersion, path, bytes, sha256 }))
  await fs.writeFile(path.join(catalogRoot, 'catalog.json'), JSON.stringify({ ...catalog, plugins: legacyPlugins }, null, 2) + '\n')
  console.log('Official catalogs written to plugins/official')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
