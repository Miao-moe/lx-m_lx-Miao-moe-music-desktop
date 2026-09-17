const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { unpackSource, validPath } = require('../../src/common/pluginSource')
const { packPlugin, MAX_UNPACKED_BYTES } = require('../../src/common/pluginPackage')
const compile = require('../../src/main/pluginCompiler/compile.cjs')

module.exports = async sourceBytes => {
  // Build outside the repository so its node_modules cannot shadow the ZIP's patched dependencies.
  const workspacePrefix = path.join(os.tmpdir(), 'lx-compiled-package-')
  const workspace = await fs.mkdtemp(workspacePrefix)
  if (!path.resolve(workspace).startsWith(path.resolve(workspacePrefix))) throw new Error('Unsafe plugin build workspace')
  const source = path.join(workspace, 'source')
  const output = path.join(workspace, 'output')
  try {
    const archive = await unpackSource(sourceBytes)
    const entries = [...archive.files]
    for (let index = 0; index < entries.length; index += 32) {
      const results = await Promise.allSettled(entries.slice(index, index + 32).map(async([name, bytes]) => {
        const filename = path.join(source, name)
        await fs.mkdir(path.dirname(filename), { recursive: true })
        await fs.writeFile(filename, bytes, { flag: 'wx' })
      }))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    await compile(source, output, archive.manifest)
    const files = []
    let size = 0
    const walk = async(directory, prefix = '') => {
      for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const name = prefix + item.name
        if (!validPath(name) || item.isSymbolicLink()) throw new Error('Invalid compiled plugin file')
        if (item.isDirectory()) await walk(path.join(directory, item.name), name + '/')
        else {
          const data = await fs.readFile(path.join(directory, item.name))
          size += data.length
          if (size > MAX_UNPACKED_BYTES || files.length >= 100) throw new Error('Compiled plugin is too large')
          files.push({ path: name, data })
        }
      }
    }
    await walk(output)
    const { id, version, apiVersion, name, description, icon, lyricEntry } = archive.manifest
    const manifest = {
      id,
      version,
      apiVersion,
      name,
      description,
      icon,
      entry: 'renderer.js',
      styles: files.some(file => file.path === 'renderer.css') ? ['renderer.css'] : [],
      ...(lyricEntry ? { lyricEntry: 'lyric.js', lyricStyles: files.some(file => file.path === 'lyric.css') ? ['lyric.css'] : [] } : {}),
      files: files.map(file => ({ path: file.path, bytes: file.data.length, sha256: createHash('sha256').update(file.data).digest('hex') })),
    }
    return packPlugin(manifest, files)
  } finally {
    await fs.rm(workspace, { recursive: true, force: true })
  }
}
