const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')
const nodeVersion = '16.17.1'

const auditPackages = (directories, files = []) => {
  const packages = new Map()
  const inspect = directory => {
    const filename = path.join(directory, 'package.json')
    if (!fs.existsSync(filename)) return
    const info = JSON.parse(fs.readFileSync(filename, 'utf8'))
    packages.set(directory, { name: info.name, version: info.version, node: info.engines?.node })
  }
  const walk = directory => {
    if (!fs.existsSync(directory)) return
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!item.isDirectory()) continue
      const child = path.join(directory, item.name)
      if (item.name.startsWith('@')) walk(child)
      else { inspect(child); walk(path.join(child, 'node_modules')) }
    }
  }
  for (const directory of directories) walk(directory)
  for (const file of files) {
    if (!file.includes('node_modules')) continue
    let directory = path.dirname(file)
    while (directory !== path.dirname(directory)) {
      if (fs.existsSync(path.join(directory, 'package.json'))) { inspect(directory); break }
      directory = path.dirname(directory)
    }
  }
  const result = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
  const incompatible = result.filter(info => info.node && !semver.satisfies(nodeVersion, info.node))
  if (incompatible.length) throw new Error('Dependencies incompatible with Node 16: ' + JSON.stringify(incompatible))
  return result
}

module.exports = { auditPackages, nodeVersion }
