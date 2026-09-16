const fs = require('node:fs/promises')
const path = require('node:path')
const { packSource } = require('../../src/common/pluginSource')
const { readTree } = require('./source-package.cjs')

async function main() {
  const [directory, filename] = process.argv.slice(2)
  if (!directory || !filename || path.extname(filename).toLowerCase() !== '.zip') throw new Error('Usage: node build-config/plugins/pack-source.cjs <source-directory> <output.zip>')
  const source = path.resolve(directory)
  const output = path.resolve(filename)
  if (output.startsWith(source + path.sep)) throw new Error('Save the ZIP outside its source directory')
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'plugin.json'), 'utf8'))
  const files = new Map()
  await readTree(source, '', files, (name, _directory, relative) => relative !== 'plugin.json' && name !== '.git' && !/^\.env(?:\.|$)/.test(name) && (name !== 'node_modules' || relative.startsWith('vendor/')))
  await fs.writeFile(output, await packSource(manifest, files))
  console.log(output)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
