import { errorForTransport } from '@common/utils/errorMessage'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isPluginId, OFFICIAL_PLUGIN_ROOT, PLUGIN_CATALOG_FILE, isPluginApiSupported, pluginPackages, type PluginPackage, type PluginPackageFormat, type PluginDisplayInfo, type PluginCatalog, type PluginCatalogEntry, type PluginId, type PluginManifest, type PluginStoreSnapshot, type PluginTransferErrorCode, type PluginSourceManifest, type PluginLoadFailure } from '@common/optionalPlugins'
import { MAX_SOURCE_BYTES, MAX_SOURCE_FILES, MAX_SOURCE_UNPACKED, validPath, packSource, unpackSource } from '@common/pluginSource'
import { MAX_PACKAGE_BYTES, MAX_UNPACKED_BYTES, packPlugin, unpackPlugin } from '@common/pluginPackage'
import { isBuiltinPlugin } from '@common/builtinPlugins'

const MAX_CATALOG_BYTES = 512 * 1024
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const validVersion = (value: unknown): value is string => typeof value == 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value)
const validHash = (value: unknown): value is string => typeof value == 'string' && /^[a-f0-9]{64}$/.test(value)
const validFile = (value: unknown): value is string => typeof value == 'string' && value.length < 180 && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
interface PluginVersionRecord { directory: string, manifestHash: string, version?: string, source?: 'official' | 'local', format?: PluginPackageFormat, sourceManifestHash?: string }
interface PluginRecord extends PluginVersionRecord {
  enabled?: boolean
  loadFailure?: PluginLoadFailure
}
type Registry = Partial<Record<PluginId, PluginRecord>>
type FetchBinary = (url: string, maxBytes: number) => Promise<Buffer>

export class PluginTransferError extends Error {
  constructor(public readonly code: PluginTransferErrorCode, message: string = code) { super(message) }
}

// Read a bounded regular file, including when it grows while being read.
const readLimitedFile = async(filename: string, limit: number) => {
  if (!(await fs.lstat(filename)).isFile()) throw new Error('Plugin file must be a regular file')
  const handle = await fs.open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('Plugin file is too large')
    const bytes = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length !== stat.size) throw new Error('Plugin file changed while reading')
    return bytes.subarray(0, length)
  } finally { await handle.close() }
}

const validText = (value: unknown, limit: number): boolean => value == null || (typeof value === 'string'
  ? value.length <= limit
  : typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 16 && Object.entries(value).every(([key, text]) =>
    /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(key) && typeof text === 'string' && text.length <= limit))
const validDisplayInfo = (value: PluginDisplayInfo) => validText(value.name, 120) && validText(value.description, 2000) &&
  (value.icon == null || (typeof value.icon === 'string' && /^#icon-[a-z0-9-]{1,64}$/.test(value.icon)))
const validPackage = (value: PluginPackage, id: PluginId, version: string, format: string) => value &&
  (format === 'zip' || format === 'lxplugin') && validHash(value.sha256) && Number.isSafeInteger(value.bytes) &&
  value.bytes > 0 && value.bytes <= (format === 'zip' ? MAX_SOURCE_BYTES : MAX_PACKAGE_BYTES) &&
  validFile(value.path) && value.path.startsWith(`${id}/${version}/`) && value.path.endsWith('.' + format)

export const parseCatalog = (bytes: Buffer): PluginCatalog => {
  if (bytes.length > MAX_CATALOG_BYTES) throw new Error('Plugin catalog is too large')
  const catalog = JSON.parse(bytes.toString('utf8')) as PluginCatalog
  if (!catalog || catalog.schemaVersion !== 2 || !Array.isArray(catalog.plugins) || catalog.plugins.length > 200) throw new Error('Invalid plugin catalog')
  const ids = new Set<string>()
  for (const plugin of catalog.plugins) {
    if (!plugin || !isPluginId(plugin.id) || ids.has(plugin.id) || !validDisplayInfo(plugin) || !validVersion(plugin.version) || !Number.isSafeInteger(plugin.apiVersion) ||
      !validPackage(plugin, plugin.id, plugin.version, typeof plugin.path === 'string' ? plugin.path.split('.').pop()! : '')) throw new Error('Invalid plugin catalog entry')
    if (plugin.packages != null && (typeof plugin.packages !== 'object' || Array.isArray(plugin.packages) ||
      Object.entries(plugin.packages).some(([format, value]) => !validPackage(value, plugin.id, plugin.version, format)))) throw new Error('Invalid plugin catalog packages')
    ids.add(plugin.id)
  }
  return catalog
}

const validateManifest = (manifest: PluginManifest, id: PluginId) => {
  if (!manifest || !isPluginId(id) || manifest.id !== id || !validDisplayInfo(manifest) || !validVersion(manifest.version) ||
    manifest.entry !== 'renderer.js' || (manifest.lyricEntry != null && manifest.lyricEntry !== 'lyric.js') ||
    !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100 ||
    !Array.isArray(manifest.styles) || (manifest.lyricStyles != null && !Array.isArray(manifest.lyricStyles))) throw new Error('Invalid plugin manifest')
  if (!isPluginApiSupported(manifest.apiVersion)) throw new PluginTransferError('incompatible', 'Plugin requires a different application version')
  if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_CATALOG_BYTES) throw new Error('Plugin manifest is too large')
  const names = new Set<string>()
  const normalizedNames = new Set<string>()
  let total = 0
  for (const file of manifest.files) {
    if (!file || !validFile(file.path) || file.path.split('/')[0].toLowerCase() === 'manifest.json' || normalizedNames.has(file.path.toLowerCase()) || !validHash(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('Invalid plugin file')
    names.add(file.path)
    normalizedNames.add(file.path.toLowerCase())
    total += file.bytes
  }
  for (const name of normalizedNames) {
    const parts = name.split('/')
    while (parts.length > 1) {
      parts.pop()
      if (normalizedNames.has(parts.join('/'))) throw new Error('Invalid plugin file: directory conflicts with file')
    }
  }
  if (total > MAX_UNPACKED_BYTES || !names.has(manifest.entry) || (manifest.lyricEntry !== undefined && !names.has(manifest.lyricEntry)) ||
    [...manifest.styles, ...(manifest.lyricStyles ?? [])].some(file => !names.has(file) || !file.endsWith('.css'))) throw new Error('Incomplete plugin package')
}

interface PluginArchive { manifest: PluginManifest, files: Array<{ path: string, data: Buffer }>, source?: SourceArchive }
interface SourceArchive { manifest: PluginSourceManifest, files: Map<string, Buffer> }
type PreparedPackage = { format: 'zip', manifest: PluginSourceManifest, source: SourceArchive } | { format: 'lxplugin', manifest: PluginManifest, archive: PluginArchive }
type PreparedImport = PreparedPackage & {
  previous: string
  replacing: boolean
  previousVersion: string | null
}

export class PluginManager {
  private revision = 0
  private catalog: PluginCatalogEntry[] = []
  private catalogError: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private catalogReady?: Promise<void>

  constructor(private readonly root: string, private readonly fetchBinary: FetchBinary, private readonly options: {
    compileSource?: (source: string, output: string, manifest: PluginSourceManifest) => Promise<void>
    onCompile?: (id: string) => void
  } = {}) {}

  private child(name: string) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Invalid plugin directory')
    const result = path.resolve(this.root, name)
    if (path.dirname(result) !== path.resolve(this.root)) throw new Error('Plugin path is outside its directory')
    return result
  }

  private async prepare() {
    await fs.mkdir(this.root, { recursive: true })
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw new Error('Plugin directory cannot be a symbolic link')
  }

  private registryMigration?: Promise<void>
  private async migrateLegacyRegistry() {
    let registry: Registry
    try { registry = JSON.parse(await fs.readFile(this.child('installed.json'), 'utf8')) } catch (error: any) { if (error.code === 'ENOENT') return; throw error }
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('Invalid plugin registry')
    let changed = false
    for (const [id, value] of Object.entries(registry)) {
      if (!value || typeof value !== 'object' || !isPluginId(id)) continue
      const record = value as PluginRecord & { previous?: PluginVersionRecord, pending?: boolean }
      if (record.previous) {
        if (record.previous.directory !== record.directory) await this.removeDirectory(id, record.previous.directory)
        delete record.previous
        changed = true
      }
      if ('pending' in record) { delete record.pending; changed = true }
      if (record.loadFailure && 'restoredVersion' in record.loadFailure) { delete record.loadFailure; changed = true }
    }
    if (changed) await this.saveRegistry(registry)
  }

  private async readRegistry(): Promise<Registry> {
    await this.prepare()
    this.registryMigration ??= this.migrateLegacyRegistry().catch(error => { this.registryMigration = undefined; throw error })
    await this.registryMigration
    try {
      const registry = JSON.parse(await fs.readFile(this.child('installed.json'), 'utf8')) as Registry
      if (!registry || typeof registry !== 'object' || Array.isArray(registry)) throw new Error('Invalid plugin registry')
      return registry
    } catch (error: any) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }

  private async saveRegistry(registry: Registry) {
    const temporary = this.child(`registry-${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(registry, null, 2))
      await fs.rename(temporary, this.child('installed.json'))
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }

  private installedDirectory(id: PluginId, name: string) {
    if (!isPluginId(id) || typeof name !== 'string' || !name.startsWith(id + '-') ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name.slice(id.length + 1))) throw new Error('Invalid installed plugin directory')
    return this.child(name)
  }

  private async removeDirectory(id: PluginId, name: string) {
    const target = this.installedDirectory(id, name)
    await this.prepare()
    await fs.rm(target, { recursive: true, force: true })
  }

  private async loadCatalogCache() {
    this.catalogReady ??= (async() => {
      await this.prepare()
      try {
        const filename = this.child('catalog-cache.json')
        const stat = await fs.lstat(filename)
        if (!stat.isFile() || stat.size > MAX_CATALOG_BYTES) return
        this.catalog = parseCatalog(await fs.readFile(filename)).plugins
      } catch (error: any) {
        if (error.code !== 'ENOENT') console.error('Plugin catalog cache could not be read:', error.message)
      }
    })()
    await this.catalogReady
  }

  private async saveCatalogCache(catalog: PluginCatalog) {
    const temporary = this.child(`catalog-${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, JSON.stringify(catalog), { flag: 'wx' })
      await fs.rename(temporary, this.child('catalog-cache.json'))
    } finally { await fs.rm(temporary, { force: true }) }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation)
    this.queue = task.catch(() => {})
    return task
  }

  async withBackupRegistry<T>(operation: (registry: Registry) => Promise<T>): Promise<T> {
    return this.exclusive(async() => operation(await this.readRegistry()))
  }

  async backupRestored() {
    this.revision++
    return this.snapshot()
  }

  private async readInstalled(id: PluginId, record: NonNullable<Registry[string]>) {
    const directory = this.installedDirectory(id, record.directory)
    if (!(await fs.lstat(directory)).isDirectory()) throw new Error('Invalid installed plugin directory')
    const manifestBytes = await readLimitedFile(path.join(directory, 'manifest.json'), MAX_CATALOG_BYTES)
    if (digest(manifestBytes) !== record.manifestHash) throw new Error('Installed plugin manifest checksum mismatch')
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as PluginManifest
    validateManifest(manifest, id)
    for (const file of manifest.files) {
      // Reject links at every level, including junctions in nested asset folders.
      let parent = directory
      for (const part of file.path.split('/').slice(0, -1)) {
        parent = path.join(parent, part)
        if (!(await fs.lstat(parent)).isDirectory()) throw new Error('Invalid installed plugin directory')
      }
      const data = await readLimitedFile(path.join(directory, file.path), file.bytes)
      if (data.length !== file.bytes || digest(data) !== file.sha256) throw new Error('Installed plugin file checksum mismatch')
    }
    const sourceDirectory = path.join(directory, '.source')
    const sourceStat = await fs.lstat(sourceDirectory).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    const format = record.format ?? (record.sourceManifestHash != null || sourceStat ? 'zip' : 'lxplugin')
    const source = record.source === 'local' ? 'local' as const : 'official' as const
    if (format === 'lxplugin') {
      if (record.sourceManifestHash != null || sourceStat) throw new Error('Unexpected sources in compiled plugin installation')
      return { manifest, directory, source, format, sourceDirectory: undefined, sourceManifest: undefined }
    }
    if (format !== 'zip' || !validHash(record.sourceManifestHash)) throw new Error('Plugin sources are missing. Reinstall the plugin from a source ZIP.')
    if (!(await fs.lstat(sourceDirectory)).isDirectory()) throw new Error('Invalid installed source directory')
    const sourceBytes = await readLimitedFile(path.join(sourceDirectory, 'plugin.json'), 4 * 1024 * 1024)
    if (digest(sourceBytes) !== record.sourceManifestHash) throw new Error('Installed source manifest checksum mismatch')
    const sourceManifest = JSON.parse(sourceBytes.toString('utf8')) as PluginSourceManifest
    if (sourceManifest.id !== id || sourceManifest.version !== manifest.version || sourceManifest.apiVersion !== manifest.apiVersion) throw new Error('Installed source does not match the plugin')
    return { manifest, directory, sourceDirectory, sourceManifest, source, format }
  }

  async snapshot(): Promise<PluginStoreSnapshot> {
    await this.loadCatalogCache()
    const revision = this.revision
    const registry = await this.readRegistry()
    const snapshot: PluginStoreSnapshot = { revision, catalog: this.catalog, installed: {}, errors: {}, sources: {}, loadFailures: {}, catalogError: this.catalogError }
    for (const [id, record] of Object.entries(registry)) {
      if (!isPluginId(id) || isBuiltinPlugin(id) || !record) continue
      snapshot.sources![id] = record.source === 'local' ? 'local' : 'official'
      if (record.loadFailure) snapshot.loadFailures![id] = record.loadFailure
      try {
        const { manifest, directory, source, format } = await this.readInstalled(id, record)
        snapshot.installed[id] = { manifest, directory, source, format, enabled: record.enabled !== false }
      } catch (error: any) {
        snapshot.errors[id] = errorForTransport(error).message
      }
    }
    return revision === this.revision ? snapshot : this.snapshot()
  }

  async refresh() {
    await this.loadCatalogCache()
    try {
      const catalog = parseCatalog(await this.fetchBinary(OFFICIAL_PLUGIN_ROOT + PLUGIN_CATALOG_FILE, MAX_CATALOG_BYTES))
      this.catalog = catalog.plugins
      this.catalogError = null
      await this.saveCatalogCache(catalog).catch((error: Error) => { console.error('Plugin catalog cache could not be saved:', error.message) })
    } catch (error: any) {
      this.catalogError = errorForTransport(error).message
    }
    this.revision++
    return this.snapshot()
  }

  async install(id: PluginId, format: PluginPackageFormat = 'lxplugin') {
    return this.exclusive(async() => {
      if (isBuiltinPlugin(id)) throw new PluginTransferError('builtin')
      if (!isPluginId(id)) throw new Error('Unknown official plugin')
      if (format !== 'lxplugin' && format !== 'zip') throw new Error('Invalid plugin package format')
      await this.loadCatalogCache()
      if (!this.catalog.length) await this.refresh()
      const entry = this.catalog.find(plugin => plugin.id === id)
      if (!entry) throw new Error(this.catalogError ?? 'Plugin is not published in the official catalog')
      if (!isPluginApiSupported(entry.apiVersion)) throw new Error('Plugin requires a different application version')
      const packages = pluginPackages(entry)
      const selected = packages[format] ?? (format === 'lxplugin' ? packages.zip : undefined)
      if (!selected) throw new Error('Plugin package format is unavailable')
      const sourcePackage = selected.path.endsWith('.zip')
      const bytes = await this.fetchBinary(new URL(selected.path, OFFICIAL_PLUGIN_ROOT).href, sourcePackage ? MAX_SOURCE_BYTES : MAX_PACKAGE_BYTES)
      if (bytes.length !== selected.bytes || digest(bytes) !== selected.sha256) throw new Error('Plugin download checksum mismatch')
      const prepared = await this.readPackage(bytes, sourcePackage ? 'zip' : 'lxplugin')
      if (prepared.manifest.id !== entry.id || prepared.manifest.version !== entry.version || prepared.manifest.apiVersion !== entry.apiVersion) throw new Error('Plugin package does not match the catalog')
      const archive = prepared.format === 'zip' ? await this.compileSource(prepared.source) : prepared.archive
      await this.commitArchive(archive, await this.readRegistry(), 'official')
      return this.snapshot()
    })
  }

  private async commitArchive(archive: PluginArchive, registry: Registry, source: 'official' | 'local') {
    const id = archive.manifest.id
    if (isBuiltinPlugin(id)) throw new PluginTransferError('builtin')
    const previous = registry[id]
    const temporaryName = `install-${randomUUID()}`
    const directoryName = `${id}-${randomUUID()}`
    const temporary = this.child(temporaryName)
    let committed = false
    try {
      await fs.mkdir(temporary)
      for (const file of archive.files) {
        const filename = path.join(temporary, file.path)
        await fs.mkdir(path.dirname(filename), { recursive: true })
        await fs.writeFile(filename, file.data, { flag: 'wx' })
      }
      const manifestBytes = Buffer.from(JSON.stringify(archive.manifest))
      await fs.writeFile(path.join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx' })
      let sourceManifestHash: string | undefined
      if (archive.source) {
        const sourceDirectory = path.join(temporary, '.source')
        await this.writeSourceFiles(sourceDirectory, archive.source)
        const sourceManifestBytes = Buffer.from(JSON.stringify(archive.source.manifest))
        await fs.writeFile(path.join(sourceDirectory, 'plugin.json'), sourceManifestBytes, { flag: 'wx' })
        sourceManifestHash = digest(sourceManifestBytes)
      }
      // A scanner can briefly hold newly written plugin files on Windows.
      // Retry only transient rename failures while the old installation remains active.
      for (let attempt = 0; ; attempt++) {
        try {
          await fs.rename(temporary, this.child(directoryName))
          break
        } catch (error) {
          if (attempt >= 4 || !['EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt))
        }
      }
      registry[id] = {
        directory: directoryName,
        manifestHash: digest(manifestBytes),
        version: archive.manifest.version,
        source,
        format: archive.source ? 'zip' : 'lxplugin',
        ...(sourceManifestHash ? { sourceManifestHash } : {}),
        enabled: previous?.enabled !== false,
      }
      await this.saveRegistry(registry)
      this.revision++
      committed = true
      if (previous) await this.removeDirectory(id, previous.directory)
    } finally {
      await this.removeDirectory('install', temporaryName)
      if (!committed) await this.removeDirectory(id, directoryName)
    }
  }

  private async readSource(bytes: Buffer): Promise<SourceArchive> {
    const source = await unpackSource(bytes) as SourceArchive
    if (!validDisplayInfo(source.manifest)) throw new Error('Invalid plugin source metadata')
    if (!isPluginApiSupported(source.manifest.apiVersion)) throw new PluginTransferError('incompatible')
    return source
  }

  async setEnabled(id: PluginId, enabled: boolean) {
    return this.exclusive(async() => {
      if (isBuiltinPlugin(id)) throw new PluginTransferError('builtin')
      if (!isPluginId(id) || typeof enabled !== 'boolean') throw new Error('Invalid plugin state')
      const registry = await this.readRegistry()
      const record = registry[id]
      if (!record) throw new PluginTransferError('not_installed')
      record.enabled = enabled
      await this.saveRegistry(registry)
      this.revision++
      return this.snapshot()
    })
  }

  async reportRuntimeResult(id: PluginId, directory: string, error?: string, lyric = false) {
    return this.exclusive(async() => {
      if (!isPluginId(id) || isBuiltinPlugin(id) || typeof directory !== 'string' || (error != null && typeof error !== 'string')) throw new Error('Invalid plugin runtime result')
      const registry = await this.readRegistry()
      const record = registry[id]
      // Ignore late reports from an unloaded installation.
      if (!record || record.enabled === false || this.installedDirectory(id, record.directory) !== directory) return this.snapshot()
      if (error == null) {
        if (record.loadFailure && (record.loadFailure.surface ?? 'main') === (lyric ? 'lyric' : 'main')) {
          delete record.loadFailure
          await this.saveRegistry(registry)
          this.revision++
        }
        return this.snapshot()
      }
      const failedVersion = record.version ?? (await this.readInstalled(id, record).catch(() => null))?.manifest.version ?? '?'
      const loadFailure: NonNullable<PluginRecord['loadFailure']> = { message: error.slice(0, 2000), failedVersion, surface: lyric ? 'lyric' : 'main' }
      if (JSON.stringify(record.loadFailure) === JSON.stringify(loadFailure)) return this.snapshot()
      record.loadFailure = loadFailure
      await this.saveRegistry(registry)
      this.revision++
      return this.snapshot()
    })
  }

  private async readPackage(bytes: Buffer, format: PluginPackageFormat): Promise<PreparedPackage> {
    if (format === 'zip') {
      const source = await this.readSource(bytes)
      return { format, manifest: source.manifest, source }
    }
    const decoded = unpackPlugin(bytes) as { manifest: PluginManifest, files: Record<string, string> }
    if (!decoded || typeof decoded !== 'object') throw new Error('Invalid plugin package')
    validateManifest(decoded.manifest, decoded.manifest?.id)
    if (!decoded.files || typeof decoded.files !== 'object' || Array.isArray(decoded.files) || Object.keys(decoded.files).length !== decoded.manifest.files.length) throw new Error('Invalid plugin package files')
    const files = decoded.manifest.files.map(file => {
      const encoded = Object.hasOwn(decoded.files, file.path) ? decoded.files[file.path] : undefined
      if (typeof encoded !== 'string' || encoded.length !== Math.ceil(file.bytes / 3) * 4) throw new Error('Invalid plugin file encoding')
      const data = Buffer.from(encoded, 'base64')
      if (data.toString('base64') !== encoded || data.length !== file.bytes || digest(data) !== file.sha256) throw new Error('Plugin file checksum mismatch')
      return { path: file.path, data }
    })
    return { format, manifest: decoded.manifest, archive: { manifest: decoded.manifest, files } }
  }

  private async writeSourceFiles(directory: string, source: SourceArchive) {
    await fs.mkdir(directory, { recursive: true })
    const entries = [...source.files]
    for (let start = 0; start < entries.length; start += 16) {
      // Wait for all writes before cleanup even if one file fails.
      const results = await Promise.allSettled(entries.slice(start, start + 16).map(async([name, bytes]) => {
        const filename = path.join(directory, name)
        await fs.mkdir(path.dirname(filename), { recursive: true })
        await fs.writeFile(filename, bytes, { flag: 'wx' })
      }))
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
  }

  private async compileSource(source: SourceArchive): Promise<PluginArchive> {
    if (!this.options.compileSource) throw new PluginTransferError('compile_failed', 'Plugin compiler is unavailable')
    this.options.onCompile?.(source.manifest.id)
    const name = `source-${randomUUID()}`
    const workspace = this.child(name)
    const inputs = path.join(workspace, 'input')
    const output = path.join(workspace, 'output')
    try {
      await this.writeSourceFiles(inputs, source)
      await this.options.compileSource(inputs, output, source.manifest)
      const files: PluginArchive['files'] = []
      let total = 0
      const walk = async(directory: string, prefix = '') => {
        for (const item of await fs.readdir(directory, { withFileTypes: true })) {
          const name = prefix + item.name
          if (!validFile(name) || item.isSymbolicLink()) throw new Error('Invalid compiled plugin file')
          if (item.isDirectory()) await walk(path.join(directory, item.name), name + '/')
          else {
            const data = await readLimitedFile(path.join(directory, item.name), MAX_UNPACKED_BYTES)
            total += data.length
            if (total > MAX_UNPACKED_BYTES || files.length >= 100) throw new Error('Compiled plugin is too large')
            files.push({ path: name, data })
          }
        }
      }
      await walk(output)
      const { id, version, apiVersion, name: title, description, icon, lyricEntry } = source.manifest
      const manifest: PluginManifest = {
        id,
        version,
        apiVersion,
        name: title,
        description,
        icon,
        entry: 'renderer.js',
        styles: files.some(file => file.path === 'renderer.css') ? ['renderer.css'] : [],
        ...(lyricEntry ? { lyricEntry: 'lyric.js', lyricStyles: files.some(file => file.path === 'lyric.css') ? ['lyric.css'] : [] } : {}),
        files: files.map(file => ({ path: file.path, bytes: file.data.length, sha256: digest(file.data) })),
      }
      validateManifest(manifest, id)
      return { manifest, files, source }
    } catch (error: any) {
      throw new PluginTransferError('compile_failed', String(error.message).slice(0, 6000))
    } finally { await this.removeDirectory('source', name) }
  }

  async prepareImport(filename: string): Promise<PreparedImport> {
    const extension = path.extname(filename).toLowerCase()
    if (extension !== '.zip' && extension !== '.lxplugin') throw new PluginTransferError('invalid_package')
    let bytes: Buffer
    try { bytes = await readLimitedFile(filename, extension === '.zip' ? MAX_SOURCE_BYTES : MAX_PACKAGE_BYTES) } catch { throw new PluginTransferError('read_failed') }
    let prepared: PreparedPackage
    try {
      prepared = await this.readPackage(bytes, extension === '.zip' ? 'zip' : 'lxplugin')
    } catch (error) {
      if (error instanceof PluginTransferError) throw error
      throw new PluginTransferError('invalid_package')
    }
    const manifest = prepared.manifest
    if (isBuiltinPlugin(manifest.id)) throw new PluginTransferError('builtin')
    return this.exclusive(async() => {
      const record = (await this.readRegistry())[manifest.id]
      let previousVersion: string | null = null
      if (record) {
        try { previousVersion = (await this.readInstalled(manifest.id, record)).manifest.version } catch { /* A valid import can repair a broken installation. */ }
      }
      return { ...prepared, previous: JSON.stringify(record ?? null), replacing: !!record, previousVersion }
    })
  }

  async importPrepared(prepared: PreparedImport) {
    return this.exclusive(async() => {
      if (isBuiltinPlugin(prepared.manifest.id)) throw new PluginTransferError('builtin')
      const registry = await this.readRegistry()
      // Confirmation applies to the exact version shown, even if another operation ran meanwhile.
      if (JSON.stringify(registry[prepared.manifest.id] ?? null) !== prepared.previous) throw new PluginTransferError('changed')
      const archive = prepared.format === 'zip' ? await this.compileSource(prepared.source) : prepared.archive
      await this.commitArchive(archive, registry, 'local')
      return this.snapshot()
    })
  }

  async createExport(id: PluginId) {
    return this.exclusive(async() => {
      if (isBuiltinPlugin(id)) throw new PluginTransferError('builtin')
      if (!isPluginId(id)) throw new PluginTransferError('not_installed')
      const record = (await this.readRegistry())[id]
      if (!record) throw new PluginTransferError('not_installed')
      try {
        const { manifest, directory, sourceDirectory, sourceManifest } = await this.readInstalled(id, record)
        if (!sourceManifest || !sourceDirectory) {
          const files = await Promise.all(manifest.files.map(async file => ({ path: file.path, data: await readLimitedFile(path.join(directory, file.path), file.bytes) })))
          for (const [index, file] of files.entries()) if (digest(file.data) !== manifest.files[index].sha256) throw new Error('Installed plugin changed during export')
          return { manifest, format: 'lxplugin' as const, bytes: packPlugin(manifest, files) }
        }
        if (!Array.isArray(sourceManifest.files) || sourceManifest.files.length > MAX_SOURCE_FILES) throw new Error('Invalid source files')
        const files = new Map<string, Buffer>()
        let total = 0
        for (const file of sourceManifest.files) {
          if (!file || !validPath(file.path) || file.path.toLowerCase() === 'plugin.json' || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !validHash(file.sha256)) throw new Error('Invalid source file')
          total += file.bytes
          if (total > MAX_SOURCE_UNPACKED) throw new Error('Plugin sources are too large')
          let parent = sourceDirectory
          for (const part of file.path.split('/').slice(0, -1)) {
            parent = path.join(parent, part)
            if (!(await fs.lstat(parent)).isDirectory()) throw new Error('Invalid installed source directory')
          }
          const bytes = await readLimitedFile(path.join(sourceDirectory, file.path), file.bytes)
          if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw new Error('Installed source file checksum mismatch')
          files.set(file.path, bytes)
        }
        return { manifest, format: 'zip' as const, bytes: await packSource(sourceManifest, files) }
      } catch { throw new PluginTransferError('corrupt_installation') }
    })
  }

  async writeExport(filename: string, bytes: Buffer, format: PluginPackageFormat = 'zip') {
    if (!['zip', 'lxplugin'].includes(format) || path.extname(filename).toLowerCase() !== '.' + format) throw new PluginTransferError('invalid_destination')
    // Resolve the parent as well, so a junction cannot redirect the export into installed plugins.
    const parent = await fs.realpath(path.dirname(path.resolve(filename)))
    const root = await fs.realpath(this.root)
    const relative = path.relative(root, parent)
    if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new PluginTransferError('invalid_destination')
    const target = path.join(parent, path.basename(filename))
    const inspect = async() => {
      try {
        const stat = await fs.lstat(target)
        if (!stat.isFile()) throw new PluginTransferError('invalid_destination')
        return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
      } catch (error: any) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    }
    const before = await inspect()
    const temporary = path.join(parent, `.plugin-export-${randomUUID()}.tmp`)
    try {
      await fs.writeFile(temporary, bytes, { flag: 'wx' })
      if (await inspect() !== before) throw new PluginTransferError('changed')
      await fs.rename(temporary, target)
    } finally { await fs.rm(temporary, { force: true }) }
    return target
  }

  async uninstall(id: PluginId) {
    return this.exclusive(async() => {
      if (isBuiltinPlugin(id)) throw new PluginTransferError('builtin')
      if (!isPluginId(id)) throw new Error('Unknown official plugin')
      const registry = await this.readRegistry()
      const previous = registry[id]
      if (previous) {
        // Keep the registration until removal succeeds, so a failed uninstall can be retried.
        await this.removeDirectory(id, previous.directory)
        Reflect.deleteProperty(registry, id)
        await this.saveRegistry(registry)
        this.revision++
      }
      return this.snapshot()
    })
  }
}
