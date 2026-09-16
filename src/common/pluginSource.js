const { createHash } = require('node:crypto')
const yauzl = require('yauzl')
const yazl = require('yazl')

const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_SOURCE_UNPACKED = 256 * 1024 * 1024
const MAX_SOURCE_FILES = 16000
const hash = data => createHash('sha256').update(data).digest('hex')
const validPath = name => typeof name === 'string' && name.length < 240 && ![...name].some(char => char.charCodeAt(0) < 32) && !/[\\:*?"<>|]/.test(name) && name.split('/').every(part =>
  part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))

// SHA-256 protects every payload; ZIP CRC also covers the manifest itself.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
const crc32 = bytes => {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const readZip = bytes => new Promise((resolve, reject) => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_SOURCE_BYTES) { reject(new Error('Source ZIP is too large')); return }
  yauzl.fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
    if (error) { reject(error); return }
    const files = new Map()
    const names = new Set()
    let total = 0
    let failed = false
    const fail = error => { failed = true; zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('end', () => {
      if (failed) return
      const fileNames = new Set([...files.keys()].map(name => name.toLowerCase()))
      for (const name of names) {
        const parts = name.split('/')
        while (parts.length > 1) { parts.pop(); if (fileNames.has(parts.join('/'))) { fail(new Error('ZIP file/directory conflict')); return } }
      }
      resolve(files)
    })
    if (zip.entryCount > MAX_SOURCE_FILES) { fail(new Error('Too many ZIP entries')); return }
    zip.on('entry', entry => {
      const directory = entry.fileName.endsWith('/')
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName
      const mode = (entry.externalFileAttributes >>> 16) & 0xf000
      if (!validPath(name) || names.has(name.toLowerCase()) || (mode && mode !== (directory ? 0x4000 : 0x8000)) || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) {
        fail(new Error('Invalid ZIP entry')); return
      }
      names.add(name.toLowerCase())
      total += entry.uncompressedSize
      if (total > MAX_SOURCE_UNPACKED || (directory && entry.uncompressedSize)) { fail(new Error('Source ZIP is too large')); return }
      if (directory) { zip.readEntry(); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { fail(error); return }
        const chunks = []
        let length = 0
        stream.on('error', fail)
        stream.on('data', chunk => {
          length += chunk.length
          if (length > entry.uncompressedSize || length > MAX_SOURCE_UNPACKED) { stream.destroy(new Error('ZIP entry exceeds its declared size')); return }
          chunks.push(chunk)
        })
        stream.on('end', () => {
          if (failed) return
          const data = Buffer.concat(chunks)
          if (length !== entry.uncompressedSize || crc32(data) !== entry.crc32) { fail(new Error('ZIP checksum mismatch')); return }
          files.set(name, data)
          zip.readEntry()
        })
      })
    })
    zip.readEntry()
  })
})

const writeZip = files => new Promise((resolve, reject) => {
  const zip = new yazl.ZipFile()
  const chunks = []
  let size = 0
  zip.on('error', reject)
  zip.outputStream.on('error', reject)
  zip.outputStream.on('data', chunk => {
    size += chunk.length
    if (size > MAX_SOURCE_BYTES) { zip.outputStream.destroy(new Error('Source ZIP is too large')); return }
    chunks.push(chunk)
  })
  zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  try {
    for (const [name, data] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (!validPath(name)) throw new Error('Invalid source path: ' + name)
      zip.addBuffer(data, name, { mtime: new Date('2000-01-01T00:00:00Z'), mode: 0o100644, compressionLevel: 9, forceDosTimestamp: true })
    }
    zip.end()
  } catch (error) { zip.outputStream.destroy(); reject(error) }
})

const validateSourceManifest = (manifest, files) => {
  if (!manifest || manifest.format !== 'lx-m-plugin-source' || manifest.formatVersion !== 1 ||
    typeof manifest.id !== 'string' || manifest.id.length > 64 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(manifest.id) || /^(constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(manifest.id) ||
    typeof manifest.version !== 'string' || !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(manifest.version) || !Number.isSafeInteger(manifest.apiVersion) || manifest.apiVersion < 1 ||
    !validPath(manifest.entry) || !manifest.entry.startsWith('src/') || !/\.(?:[cm]?js|jsx|ts|tsx)$/.test(manifest.entry) || !files.has(manifest.entry) ||
    (manifest.lyricEntry != null && (!validPath(manifest.lyricEntry) || !manifest.lyricEntry.startsWith('src/') || !/\.(?:[cm]?js|jsx|ts|tsx)$/.test(manifest.lyricEntry) || !files.has(manifest.lyricEntry))) ||
    !Array.isArray(manifest.files) || manifest.files.length !== files.size || manifest.files.length > MAX_SOURCE_FILES) throw new Error('Invalid source manifest')
  const names = new Set()
  for (const file of manifest.files) {
    if (!file || !validPath(file.path) || file.path === 'plugin.json' || names.has(file.path.toLowerCase()) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid source file')
    names.add(file.path.toLowerCase())
    const data = files.get(file.path)
    if (!data || data.length !== file.bytes || hash(data) !== file.sha256) throw new Error('Source checksum mismatch')
  }
  for (const name of names) {
    const parts = name.split('/')
    while (parts.length > 1) { parts.pop(); if (names.has(parts.join('/'))) throw new Error('Source path conflict') }
  }
  const assets = manifest.assets ?? []
  if (!Array.isArray(assets) || assets.length > 30) throw new Error('Invalid source assets')
  for (const asset of assets) {
    if (!asset || !validPath(asset.from) || !asset.from.startsWith('src/') || !validPath(asset.to) || /^(renderer\.|lyric\.|manifest\.json|\.source)/i.test(asset.to) || ![...files.keys()].some(name => name === asset.from || name.startsWith(asset.from + '/'))) throw new Error('Invalid source asset')
  }
  const browser = manifest.browser
  if (browser != null) {
    if (typeof browser !== 'object' || !validPath(browser.entry) || !files.has(browser.entry) || !browser.entry.startsWith('src/') || !/\.(?:[cm]?js|jsx|ts|tsx)$/.test(browser.entry) || browser.output !== 'engine' || (browser.tailwind != null && typeof browser.tailwind !== 'boolean')) throw new Error('Invalid browser entry')
    if (browser.aliases != null && (typeof browser.aliases !== 'object' || Array.isArray(browser.aliases) || Object.keys(browser.aliases).length > 30)) throw new Error('Invalid browser aliases')
    for (const [alias, target] of Object.entries(browser.aliases ?? {})) {
      if (!/^[@a-zA-Z][@a-zA-Z0-9/_-]*$/.test(alias) || !validPath(target) || !target.startsWith('src/')) throw new Error('Invalid browser alias')
    }
    if (!Array.isArray(browser.replacements ?? []) || (browser.replacements?.length ?? 0) > 30) throw new Error('Invalid browser replacements')
    for (const item of browser.replacements ?? []) {
      if (!validPath(item.from) || !item.from.startsWith('src/') || !validPath(item.to) || !files.has(item.to) || !item.to.startsWith('src/')) throw new Error('Invalid browser replacement')
    }
  }
}

const unpackSource = async bytes => {
  let files = await readZip(bytes)
  if (!files.has('plugin.json')) {
    const roots = [...files.keys()].filter(name => /^[^/]+\/plugin\.json$/.test(name))
    if (roots.length !== 1) throw new Error('Missing plugin.json')
    const prefix = roots[0].slice(0, -'plugin.json'.length)
    if ([...files.keys()].some(name => !name.startsWith(prefix))) throw new Error('Ambiguous source ZIP root')
    files = new Map([...files].map(([name, data]) => [name.slice(prefix.length), data]))
  }
  const json = files.get('plugin.json')
  if (json.length > 4 * 1024 * 1024) throw new Error('Source manifest is too large')
  const manifest = JSON.parse(json.toString('utf8'))
  files.delete('plugin.json')
  validateSourceManifest(manifest, files)
  return { manifest, files }
}

const packSource = async(manifest, files) => {
  const complete = { ...manifest, format: 'lx-m-plugin-source', formatVersion: 1, files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: hash(data) })) }
  validateSourceManifest(complete, files)
  const archive = new Map(files)
  archive.set('plugin.json', Buffer.from(JSON.stringify(complete, null, 2) + '\n'))
  const bytes = await writeZip(archive)
  await unpackSource(bytes)
  return bytes
}

module.exports = { MAX_SOURCE_BYTES, MAX_SOURCE_UNPACKED, MAX_SOURCE_FILES, hash, validPath, readZip, writeZip, unpackSource, packSource }
