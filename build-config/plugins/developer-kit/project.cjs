const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { prepareSource, packPreparedSource, unpackSource, MAX_SOURCE_FILES, MAX_SOURCE_UNPACKED } = require('../../../src/common/pluginSource')
const { version } = require('../../../plugins/developer-kit/package.json')

const defaultKit = path.resolve(__dirname, '../../../plugins/developer-kit')
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep)
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const optionalStat = filename => fs.lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
const isPrivateFile = name => /^\.env(?:\.|$)/i.test(name) || ['.npmrc', '.yarnrc', '.yarnrc.yml', '.netrc', '_netrc'].includes(name.toLowerCase())

const readTree = async(directory, prefix, files, filter = () => true, budget = { bytes: 0 }) => {
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const relative = prefix + item.name
    if (isPrivateFile(item.name)) continue
    if (!filter(item.name, item.isDirectory(), relative)) continue
    if (item.isSymbolicLink()) throw new Error('Source packages cannot include symbolic links: ' + relative)
    const filename = path.join(directory, item.name)
    if (item.isDirectory()) await readTree(filename, relative + '/', files, filter, budget)
    else {
      const stat = await fs.lstat(filename)
      if (!stat.isFile()) throw new Error('Unsupported source file: ' + relative)
      budget.bytes += stat.size
      if (files.size >= MAX_SOURCE_FILES - 1 || budget.bytes > MAX_SOURCE_UNPACKED) throw new Error('Source package exceeds its size limit')
      files.set(relative, await fs.readFile(filename))
    }
  }
}

// Shared by the standalone tool and the four official plugin builds.
const prepareFiles = async(manifest, originalFiles, kit = defaultKit) => {
  const files = new Map(originalFiles)
  for (const name of ['DEVELOPMENT.md', 'types/lx-m-plugin.d.ts', 'tsconfig.json']) {
    if (!files.has(name)) files.set(name, await fs.readFile(path.join(kit, name)))
  }
  if (!files.has('package.json')) {
    files.set('package.json', json({
      name: manifest.id,
      version: manifest.version,
      private: true,
      devDependencies: { vue: '~3.3.13', typescript: '5.9.3', '@types/node': '^20.19.39' },
    }))
  }
  const sorted = new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  return prepareSource({ ...manifest, devkit: { name: 'lx-m-plugin-devkit', version } }, sorted)
}

const packFiles = async(manifest, files, kit = defaultKit) => packPreparedSource(await prepareFiles(manifest, files, kit))

const projectFiles = async directory => {
  const source = await fs.realpath(directory)
  if (!(await fs.stat(source)).isDirectory()) throw new Error('Expected a plugin directory')
  const manifestPath = path.join(source, 'plugin.json')
  const stat = await fs.lstat(manifestPath)
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Invalid plugin.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const files = new Map()
  await readTree(source, '', files, (name, _directory, relative) => {
    if (relative === 'plugin.json' || ['.git', '.svn', '.DS_Store', 'Thumbs.db'].includes(name)) return false
    // Bundled packages may legitimately contain dist/, build/ and nested node_modules/.
    if (relative.startsWith('vendor/')) return true
    return !['node_modules', 'dist', 'build', 'coverage', '.idea', '.vscode'].includes(name) && !/\.(?:zip|lxplugin|log|tsbuildinfo)$/i.test(name)
  })
  return { manifest, files, source }
}

const writeOutput = async(filename, bytes) => {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const stat = await optionalStat(filename)
  if (stat && !stat.isFile()) throw new Error('Output must be a regular file: ' + filename)
  if (stat && (await fs.readFile(filename)).equals(bytes)) return
  const temporary = filename + '.' + randomUUID() + '.tmp'
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx' })
    await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }) }
}

const packProject = async(directory, filename, kit = defaultKit) => {
  const source = await fs.realpath(directory)
  const output = path.resolve(filename ?? source + '.zip')
  if (path.extname(output).toLowerCase() !== '.zip') throw new Error('Output filename must end in .zip')
  if (inside(source, output)) throw new Error('Save the ZIP outside its source directory')
  await fs.mkdir(path.dirname(output), { recursive: true })
  const physicalOutput = path.join(await fs.realpath(path.dirname(output)), path.basename(output))
  if (inside(source, physicalOutput)) throw new Error('Save the ZIP outside its source directory')
  const { manifest, files } = await projectFiles(source)
  const prepared = await prepareFiles(manifest, files, kit)
  const bytes = await packPreparedSource(prepared)
  await writeOutput(physicalOutput, bytes)
  return { output, manifest: prepared.manifest, bytes: bytes.length }
}

// Create in a fresh sibling directory; invalid archives never leave partial projects.
const writeProject = async(directory, files) => {
  const target = path.resolve(directory)
  if (await optionalStat(target)) throw new Error('Destination already exists: ' + target)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temporary = await fs.mkdtemp(path.join(path.dirname(target), '.lx-plugin-'))
  if (path.dirname(temporary) !== path.dirname(target) || !path.basename(temporary).startsWith('.lx-plugin-')) throw new Error('Invalid temporary project path')
  try {
    for (const [name, bytes] of files) {
      const filename = path.resolve(temporary, name)
      if (!inside(temporary, filename) || filename === temporary) throw new Error('Invalid project path')
      await fs.mkdir(path.dirname(filename), { recursive: true })
      await fs.writeFile(filename, bytes, { flag: 'wx' })
    }
    if (await optionalStat(target)) throw new Error('Destination already exists: ' + target)
    await fs.rename(temporary, target)
  } finally { await fs.rm(temporary, { recursive: true, force: true }) }
  return target
}

const unpackProject = async(filename, directory) => {
  const { manifest, files } = await unpackSource(await fs.readFile(filename))
  files.set('plugin.json', json(manifest))
  return writeProject(directory, files)
}

const initProject = async(directory, id, kit = defaultKit) => {
  const { manifest, files } = await projectFiles(path.join(kit, 'template'))
  manifest.id = id ?? path.basename(path.resolve(directory))
  manifest.name = manifest.id
  files.delete('package.json')
  const packed = await prepareFiles(manifest, files, kit)
  packed.files.set('plugin.json', packed.manifestBytes)
  return writeProject(directory, packed.files)
}

const checkProject = async(filename, kit = defaultKit) => {
  const stat = await fs.stat(filename)
  if (!stat.isDirectory()) return unpackSource(await fs.readFile(filename))
  const { manifest, files } = await projectFiles(filename)
  return prepareFiles(manifest, files, kit)
}

module.exports = { version, readTree, prepareFiles, packFiles, projectFiles, packProject, unpackProject, initProject, checkProject, writeProject, writeOutput }
