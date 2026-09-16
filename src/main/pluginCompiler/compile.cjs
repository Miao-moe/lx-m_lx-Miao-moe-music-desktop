const fs = require('node:fs/promises')
const path = require('node:path')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const externals = require('./host.cjs')
const pxtorem = require('postcss-pxtorem')

const run = config => new Promise((resolve, reject) => {
  const compiler = webpack(config)
  compiler.run((error, stats) => compiler.close(() => {
    if (error) reject(error)
    else if (stats.hasErrors()) reject(new Error(stats.toString({ all: false, errors: true, errorDetails: false }).slice(0, 6000)))
    else resolve()
  }))
})

const cssLoaders = (modules, extra = []) => [
  { loader: MiniCssExtractPlugin.loader, options: { esModule: false } },
  { loader: require.resolve('css-loader'), options: { esModule: !modules, ...(modules ? { modules: { localIdentName: '[hash:base64:5]', exportLocalsConvention: 'camelCase', namedExport: false } } : {}) } },
  ...extra,
]

const baseConfig = (source, output, browser = false) => ({
  mode: 'production',
  context: source,
  target: browser ? ['web', 'es2020'] : 'electron-renderer',
  devtool: false,
  cache: false,
  output: { path: output, filename: '[name].js', chunkFilename: '[name].js', publicPath: '', ...(browser ? {} : { library: { type: 'commonjs2' } }) },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json'],
    modules: ['node_modules', path.join(source, 'vendor', browser ? 'engine' : 'main')],
    alias: Object.fromEntries(Object.entries({ '@root': '', '@common': 'common', '@renderer': 'renderer', '@lyric': 'renderer-lyric', '@static': 'static' }).map(([name, directory]) => [name, path.join(source, 'sdk', directory)])),
  },
  resolveLoader: { modules: [path.join(__dirname, 'node_modules'), path.join(__dirname, '../../../node_modules')] },
  module: {
    rules: [
      { test: /\.(tsx?|jsx)$/, exclude: /node_modules/, use: { loader: require.resolve('ts-loader'), options: { appendTsSuffixTo: [/\.vue$/], transpileOnly: true, configFile: path.join(__dirname, 'tsconfig.json') } } },
      { test: /\.vue$/, loader: require.resolve('vue-loader') },
      { test: /\.pug$/, loader: require.resolve('pug-plain-loader') },
      { test: /\.css$/, oneOf: [{ resourceQuery: /module/, use: cssLoaders(true, hostPostcss(browser)) }, { use: cssLoaders(false, hostPostcss(browser)) }] },
      { test: /\.less$/, oneOf: [{ resourceQuery: /module/, use: cssLoaders(true, [...hostPostcss(browser), require.resolve('less-loader')]) }, { use: cssLoaders(false, [...hostPostcss(browser), require.resolve('less-loader')]) }] },
      { test: /\.(png|jpe?g|gif|svg|webp|avif|woff2?|eot|ttf|otf|mp3|wav|ogg|flac)$/, type: 'asset', parser: { dataUrlCondition: { maxSize: 10000 } }, generator: { filename: 'assets/[name]-[contenthash:8][ext]' } },
    ],
  },
  optimization: { minimize: false, splitChunks: false, runtimeChunk: false },
  plugins: [
    new VueLoaderPlugin(),
    new MiniCssExtractPlugin({ filename: '[name].css' }),
    new webpack.DefinePlugin({ __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false', 'process.env.NODE_ENV': '"production"' }),
    {
      apply(compiler) {
        compiler.hooks.normalModuleFactory.tap('PluginSourceLoaders', factory => {
          factory.hooks.beforeResolve.tap('PluginSourceLoaders', request => {
            if (!request?.request.includes('!')) return
            const loaders = request.request.split('!=!').at(-1).replace(/^-?!+/, '').split('!').slice(0, -1).filter(Boolean)
            const tools = path.dirname(path.dirname(require.resolve('webpack/package.json')))
            for (const loader of loaders) {
              const filename = path.resolve(request.context, loader.split('?')[0])
              if (!filename.startsWith(tools + path.sep) && filename !== path.join(__dirname, 'tailwind-loader.cjs')) throw new Error('Only the built-in plugin loaders are supported')
            }
          })
        })
      },
    },
  ],
  node: { __dirname: false, __filename: false },
  performance: { hints: false },
})

function hostPostcss(browser) {
  if (browser) return []
  return [{
    loader: require.resolve('postcss-loader'),
    options: {
      postcssOptions: {
        config: false,
        plugins: [pxtorem({
          rootValue: 16,
          unitPrecision: 5,
          propList: ['font', 'font-size', 'letter-spacing', 'padding', 'margin', 'padding-*', 'margin-*', 'height', 'width', '*-height', '*-width', 'flex', '::-webkit-scrollbar', 'top', 'left', 'bottom', 'right', 'border-radius', 'gap'],
          selectorBlackList: ['html', 'ignore-to-rem'],
          replace: true,
          mediaQuery: false,
          minPixelValue: 0,
          exclude: [/node_modules/i],
        })],
      },
    },
  }]
}

module.exports = async(source, output, manifest) => {
  await fs.mkdir(output, { recursive: true })
  const config = baseConfig(source, output)
  config.entry = { renderer: path.join(source, manifest.entry) }
  if (manifest.lyricEntry) config.entry.lyric = path.join(source, manifest.lyricEntry)
  config.externalsType = 'var'
  config.externals = externals
  await run(config)
  for (const asset of manifest.assets ?? []) await fs.cp(path.join(source, asset.from), path.join(output, asset.to), { recursive: true, force: false, errorOnExist: true })
  if (manifest.browser) {
    const browser = manifest.browser
    const engine = baseConfig(source, path.join(output, browser.output), true)
    const engineRoot = path.dirname(path.join(source, browser.entry))
    engine.entry = { engine: path.join(source, browser.entry) }
    Object.assign(engine.resolve.alias, Object.fromEntries(Object.entries(browser.aliases ?? {}).map(([name, target]) => [name, path.join(source, target)])))
    const replacements = new Map((browser.replacements ?? []).map(item => [path.join(source, item.from).replaceAll('\\', '/'), path.join(source, item.to)]))
    engine.plugins.push(new webpack.NormalModuleReplacementPlugin(/^\./, resource => {
      const target = replacements.get(path.resolve(resource.context, resource.request).replaceAll('\\', '/').replace(/\.[jt]sx?$/, ''))
      if (target) resource.request = target
    }))
    if (browser.tailwind) {
      const tailwind = require('./load-tailwind.cjs')()
      const cssRule = engine.module.rules.find(rule => rule.test.test('styles.css'))
      cssRule.oneOf = [{ use: cssLoaders(false, [{ loader: require.resolve('postcss-loader'), options: { postcssOptions: { config: false, plugins: [tailwind({ base: engineRoot, optimize: false })] } } }, path.join(__dirname, 'tailwind-loader.cjs')]) }]
    }
    await run(engine)
    await fs.writeFile(path.join(output, browser.output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./engine.css"></head><body><div id="root"></div><script src="./engine.js"></script></body></html>\n')
  }
}
