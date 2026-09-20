const fs = require('node:fs/promises')
const path = require('node:path')
const webpack = require('webpack')
const { packageDirectory } = require('./stage-compiler.cjs')
const { writeZip } = require('../../src/common/pluginSource')
const { readTree, prepareFiles, writeOutput, version } = require('./developer-kit/project.cjs')

const root = path.resolve(__dirname, '../..')
const kit = path.join(root, 'plugins/developer-kit')

const bundle = () => new Promise((resolve, reject) => {
  const compiler = webpack({
    mode: 'production',
    target: 'node22',
    entry: path.join(__dirname, 'developer-kit/cli.cjs'),
    output: { path: kit, filename: 'lx-plugin.cjs' },
    devtool: false,
    optimization: { minimize: false },
    node: { __dirname: false, __filename: false },
    performance: { hints: false },
  })
  compiler.run((error, stats) => compiler.close(() => {
    if (error) reject(error)
    else if (stats.hasErrors() || stats.hasWarnings()) reject(new Error(stats.toString({ all: false, errors: true, warnings: true })))
    else resolve()
  }))
})

async function main() {
  await bundle()
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(kit, 'LICENSE'))
  await fs.writeFile(path.join(kit, 'SOURCE-FORMAT.md'), (await fs.readFile(path.join(root, 'plugins/SOURCE-FORMAT.md'), 'utf8')).replaceAll('(developer-kit/', '('))
  const licenses = []
  for (const name of ['yauzl', 'yazl', 'pend', 'buffer-crc32']) {
    const directory = packageDirectory(name, root)
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    const texts = []
    for (const filename of await fs.readdir(directory)) {
      if (/^(license|licence|copying|notice)([.-]|$)/i.test(filename) && (await fs.stat(path.join(directory, filename))).isFile()) texts.push(await fs.readFile(path.join(directory, filename), 'utf8'))
    }
    if (!texts.length) throw new Error('Missing bundled dependency license: ' + name)
    licenses.push(`${name} ${info.version} (${info.license})\n\n${texts.join('\n')}`)
  }
  await fs.writeFile(path.join(kit, 'THIRD-PARTY-LICENSES.txt'), licenses.join('\n\n========================================\n\n') + '\n')
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugins/template/plugin.json'), 'utf8'))
  const files = new Map()
  await readTree(path.join(root, 'plugins/template'), '', files, name => name !== 'plugin.json')
  files.set('LICENSE', await fs.readFile(path.join(kit, 'LICENSE')))
  const template = await prepareFiles(manifest, files, kit)
  template.files.set('plugin.json', template.manifestBytes)
  const templateRoot = path.resolve(kit, 'template')
  if (path.dirname(templateRoot) !== kit) throw new Error('Invalid template output path')
  await fs.rm(templateRoot, { recursive: true, force: true })
  for (const [name, bytes] of template.files) {
    const target = path.join(templateRoot, name)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, bytes)
  }
  const archive = new Map()
  await readTree(kit, 'developer-kit/', archive)
  const output = path.join(root, `plugins/lx-m-plugin-devkit-${version}.zip`)
  await writeOutput(output, await writeZip(archive))
  console.log('Standalone plugin toolkit: ' + output)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
