const fs = require('node:fs/promises')
const path = require('node:path')
const { createRequire } = require('node:module')
const { readTree, writeProject } = require('./project.cjs')

const packageDirectory = async(name, from) => {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid dependency name: ' + name)
  const resolve = createRequire(path.join(from, 'package.json')).resolve
  // Locate installed metadata without resolving a CommonJS entry. ESM-only and
  // subpath-only packages can hide both their root entry and package.json.
  for (const modules of resolve.paths(name) ?? []) {
    const directory = path.join(modules, name)
    const stat = await fs.lstat(path.join(directory, 'package.json')).catch(error => {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
      return null
    })
    if (!stat) continue
    if (!stat.isFile()) throw new Error('Invalid dependency manifest: ' + name)
    return fs.realpath(directory)
  }
  throw new Error('Cannot locate dependency: ' + name)
}

const dependencyFiles = async(dependencies, from, prefix, files) => {
  const modules = path.join(from, 'node_modules')
  const visited = new Set()
  const versions = {}
  const budget = { bytes: 0 }
  const copy = async(name, parent, optional = false) => {
    let directory
    try { directory = await packageDirectory(name, parent) } catch (error) { if (optional) return; throw error }
    if (visited.has(directory)) return
    const relative = path.relative(modules, directory).replaceAll('\\', '/')
    if (relative.startsWith('../') || path.isAbsolute(relative)) {
      if (optional) return
      throw new Error('Dependency must be installed inside the plugin project: ' + name)
    }
    visited.add(directory)
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    versions[relative] = { name: info.name, version: info.version, license: info.license ?? null }
    await readTree(directory, prefix + relative + '/', files, (name, directory) => directory
      ? !['node_modules', '.git', 'test', 'tests', '__tests__', 'coverage', '.github'].includes(name)
      : !name.endsWith('.map') && !/\.d\.[cm]?ts$/.test(name), budget)
    for (const dependency of Object.keys(info.dependencies ?? {})) await copy(dependency, directory, !!info.optionalDependencies?.[dependency])
    for (const dependency of Object.keys(info.optionalDependencies ?? {})) await copy(dependency, directory, true)
    // Installed peer dependencies also have to be available during offline compilation.
    for (const dependency of Object.keys(info.peerDependencies ?? {})) await copy(dependency, directory, !!info.peerDependenciesMeta?.[dependency]?.optional)
  }
  for (const [name, version] of Object.entries(dependencies)) {
    const directory = await packageDirectory(name, from)
    const info = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'))
    if (info.version !== version) throw new Error(`Pin ${name} to its installed version ${info.version} in package.json (got ${version})`)
    await copy(name, from)
  }
  files.set(prefix + 'dependencies.json', Buffer.from(JSON.stringify(versions, null, 2) + '\n'))
}

const vendorProject = async(directory, target = 'main') => {
  if (!['main', 'engine'].includes(target)) throw new Error('Dependency target must be main or engine')
  const source = await fs.realpath(directory)
  await fs.access(path.join(source, 'plugin.json'))
  const from = target === 'engine' ? path.join(source, 'src/engine') : source
  const info = JSON.parse(await fs.readFile(path.join(from, 'package.json'), 'utf8'))
  const files = new Map()
  await dependencyFiles(info.dependencies ?? {}, from, '', files)
  return writeProject(path.join(source, 'vendor', target), files)
}

module.exports = { dependencyFiles, vendorProject }
