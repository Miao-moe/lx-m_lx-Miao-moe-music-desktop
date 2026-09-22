const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const { once } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const { song, task } = require('./helpers/webdav-fixture.cjs')
const log = { error() {} }
const load = overrides => loader({ 'electron-log/node': log, '@common/utils': { log }, ...overrides })
const schema = load()('src/common/backup.ts')
const io = load()('src/common/utils/nodejs.ts')
const fixture = async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-backup-test-'))
  t.after(async() => { assert(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-backup-test-'))); await fs.rm(directory, { recursive: true, force: true }) })
  return directory
}
const full = () => ({ type: 'allData_v3', version: 3, createdAt: Date.now(), data: {
  playlists: [{ id: 'list', name: 'Playlist', list: [song('a')], locationUpdateTime: null }],
  settings: { 'player.volume': 0.5, 'desktopLyric.x': 250, 'common.langId': 'zh-cn' },
  downloads: [task('a')], lyrics: [{ id: 'wy_a', lyric: { lyric: '[00:01] Edited', tlyric: 'Translation' } }],
  plugins: { enabled: { 'folia-lyrics': false }, preferences: { 'folia-lyrics.json': { enabled: true, mode: 'classic' } }, soundEffect: {} },
  library: { preferences: { lists: { list: { folder: '日常', tags: ['学习'], pinned: true } }, folders: [] }, versions: [{ listId: 'list', time: 1000, reason: 'manual', songs: [song('a')] }], listening: [{ time: 2000, song: song('a') }], tracks: [{ id: 'wy_a', added_at: 1000, last_played: 2000, missing: 0 }] },
} })

test('D03/D05: complete backups round-trip all supported sections, preserving paths and pausing tasks', async t => {
  const root = await fixture(t), filename = path.join(root, 'all')
  const target = await io.saveLxConfigFile(filename, full())
  assert.equal(target, filename + '.lxmc')
  const result = schema.normalizeBackup(await io.readLxConfigFile(target))
  assert.equal(result.playlists[0].list[0].id, 'wy_a')
  assert.equal(result.downloads[0].metadata.filePath, 'D:/local/a.mp3')
  assert.equal(result.downloads[0].metadata.url, null)
  assert.equal(result.downloads[0].status, 'pause')
  assert.equal(result.lyrics[0].lyric.tlyric, 'Translation')
  assert.equal(result.plugins.preferences['folia-lyrics.json'].mode, 'classic')
  assert.equal(result.settings['desktopLyric.x'], 250)
  assert.equal(result.library.preferences.lists.list.folder, '日常')
  assert.equal(result.library.versions[0].songs[0].id, 'wy_a')
  assert.equal(result.library.listening[0].time, 2000)
})
test('D01: export waits for the rename and failed writes preserve the previous backup', async t => {
  const root = await fixture(t), filename = path.join(root, 'existing.lxmc')
  await fs.writeFile(filename, 'previous')
  let release, reached
  const waiting = new Promise(resolve => { reached = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const controlled = load({ 'node:fs/promises': { ...fs, rename: async() => { reached(); await barrier; throw Object.assign(Error('disk blocked'), { code: 'EACCES' }) } } })('src/common/utils/nodejs.ts')
  let settled = false
  const result = controlled.saveLxConfigFile(filename, full()).finally(() => { settled = true })
  const rejected = assert.rejects(result, /disk blocked/)
  await waiting
  assert.equal(settled, false)
  assert.equal(await fs.readFile(filename, 'utf8'), 'previous')
  release(); await rejected
  assert.deepEqual(await fs.readdir(root), ['existing.lxmc'])
})
test('D02/D03: malformed JSON, gzip, empty input and invalid root are surfaced', async t => {
  const root = await fixture(t)
  for (const [name, data, error] of [['bad.json', '{oops', /backup:json/], ['bad.lxmc', 'not gzip', /backup:compression/], ['empty.json', '', /backup:json/], ['null.json', 'null', /backup:invalid/]]) {
    const file = path.join(root, name); await fs.writeFile(file, data)
    await assert.rejects(io.readLxConfigFile(file), error)
  }
})
test('D03: compressed input and decompressed output have independent limits', async t => {
  const root = await fixture(t), large = path.join(root, 'large.json')
  const handle = await fs.open(large, 'w'); await handle.truncate(schema.MAX_BACKUP_FILE + 1); await handle.close()
  await assert.rejects(io.readLxConfigFile(large), /backup:file_size/)
  const compressed = path.join(root, 'expanded.lxmc')
  const gzip = zlib.createGzip(), output = require('node:fs').createWriteStream(compressed)
  gzip.pipe(output)
  const done = once(output, 'close')
  const chunk = Buffer.alloc(1024 * 1024, 32)
  for (let i = 0; i <= schema.MAX_BACKUP_EXPANDED / chunk.length; i++) if (!gzip.write(chunk)) await once(gzip, 'drain')
  gzip.end(); await done
  assert((await fs.stat(compressed)).size < schema.MAX_BACKUP_FILE)
  await assert.rejects(io.readLxConfigFile(compressed), /backup:expanded_size/)
})
test('D03: historical v2, v1 and double-serialized files remain importable', async t => {
  const modern = song('a'), old = { name: modern.name, singer: modern.singer, songmid: 'a', source: 'wy', albumName: 'Album', interval: '03:10', types: [], _types: {} }
  assert.equal(schema.normalizeBackup({ type: 'playList', data: [{ id: 'old', name: 'Old', list: [old] }] }).playlists[0].list[0].id, 'wy_a')
  assert.equal(schema.normalizeBackup({ type: 'defautlList', data: { list: [old] } }).playlists[0].id, 'default')
  assert.equal(schema.normalizeBackup({ type: 'setting', data: { version: '1.0.0', player: { volume: 0.2 } } }).settings['player.volume'], 0.2)
  const root = await fixture(t), file = path.join(root, 'v2.json')
  await fs.writeFile(file, JSON.stringify(JSON.stringify({ type: 'allData_v2', playList: [{ id: 'v2', name: 'V2', list: [modern] }], setting: { 'player.volume': 0.4 } })))
  assert.equal(schema.normalizeBackup(await io.readLxConfigFile(file)).settings['player.volume'], 0.4)
})
for (const [name, mutate] of [
  ['missing settings', data => { data.data.settings = null }],
  ['wrong setting type', data => { data.data.settings['player.volume'] = 'loud' }],
  ['invalid song metadata', data => { delete data.data.playlists[0].list[0].meta }],
  ['duplicate playlist IDs', data => { data.data.playlists.push(data.data.playlists[0]) }],
  ['invalid download', data => { data.data.downloads[0].metadata.quality = 'invalid' }],
  ['invalid lyric', data => { data.data.lyrics[0].lyric.lyric = {} }],
  ['path traversal', data => { data.data.plugins.preferences['../../outside.json'] = {} }],
  ['case-colliding preference paths', data => { data.data.plugins.preferences['Folia-lyrics.json'] = {} }],
  ['incomplete preset', data => { data.data.plugins.soundEffect.eqPreset = [{ id: 'x', name: 'incomplete' }] }],
  ['invalid enabled state', data => { data.data.plugins.enabled['folia-lyrics'] = 'yes' }],
]) test('D03: reject ' + name + ' before any restore', () => { const data = full(); mutate(data); assert.throws(() => schema.normalizeBackup(data), /backup:invalid/) })
test('D03: prototype keys and deeply nested content are rejected before merging', () => {
  assert.throws(() => schema.normalizeBackup(JSON.parse('{"type":"setting_v2","data":{"__proto__":{"polluted":true}}}')), /backup:invalid/)
  let data = {}; for (let i = 0; i < 40; i++) data = { nested: data }
  assert.throws(() => schema.validateJsonTree(data), /backup:invalid/)
  assert.equal({}.polluted, undefined)
})
