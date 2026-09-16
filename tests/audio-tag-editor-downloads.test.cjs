const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { canEditDownload, resolveDownloadFile } = require('../src/optional-plugins/audio-tag-editor/downloadFile')
const { readTags, saveTags } = require('../src/optional-plugins/audio-tag-editor/metadata')
const { mp3 } = require('./helpers/tag-fixtures.cjs')

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-tag-download-'))
  t.after(async() => {
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'lx-tag-download-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const current = path.join(directory, 'Downloads')
  const grouped = path.join(current, '歌单')
  await fs.mkdir(grouped, { recursive: true })
  const filename = '歌曲 日本語.MP3'
  const original = path.join(directory, filename)
  const task = { id: 'song', isComplate: true, status: 'completed', metadata: { filePath: original, fileName: filename } }
  const bytes = mp3({ title: 'Original' }).bytes
  await fs.writeFile(original, bytes)
  return { directory, current, grouped, filename, original, task, bytes }
}

test('only completed supported downloads are eligible, even when isComplate is stale', async t => {
  const { task, current } = await fixture(t)
  assert.equal(canEditDownload(task), true)
  for (const status of ['run', 'waiting', 'pause', 'error', undefined]) {
    const pending = { ...task, status }
    assert.equal(canEditDownload(pending), false)
    await assert.rejects(resolveDownloadFile(pending, [current]), { code: 'DOWNLOAD_INCOMPLETE' })
  }
  assert.equal(canEditDownload({ ...task, isComplate: false }), false)
  assert.equal(canEditDownload({ ...task, metadata: { fileName: 'song.wav' } }), false)
  assert.equal(canEditDownload(undefined), false)
  await assert.rejects(resolveDownloadFile(undefined, [current]), { code: 'TASK_MISSING' })
})

test('the existing recorded path takes precedence over same-name files elsewhere', async t => {
  const { task, current, grouped, original, filename } = await fixture(t)
  await fs.writeFile(path.join(current, filename), mp3({ title: 'Different song' }).bytes)
  await fs.writeFile(path.join(grouped, filename), mp3({ title: 'Another song' }).bytes)
  assert.equal(await resolveDownloadFile(task, [grouped, current]), original)
})

test('moved and legacy downloads resolve in the current grouped or root download directory', async t => {
  const { task, current, grouped, original, filename } = await fixture(t)
  const groupedFile = path.join(grouped, filename)
  await fs.rename(original, groupedFile)
  assert.equal(await resolveDownloadFile(task, [grouped, current]), groupedFile)
  const currentFile = path.join(current, filename)
  await fs.rename(groupedFile, currentFile)
  assert.equal(await resolveDownloadFile(task, [grouped, current, current]), currentFile)
  task.metadata.filePath = ''
  assert.equal(await resolveDownloadFile(task, [grouped, current]), currentFile)
})

test('missing files and missing directories report absence without creating any files', async t => {
  const { task, current, original, filename } = await fixture(t)
  await fs.unlink(original)
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'ENOENT' })
  task.metadata.filePath = path.join(original, filename)
  await fs.writeFile(original, 'a file, not a directory')
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(current), ['歌单'])
})

test('ambiguous fallback files require the user to choose explicitly', async t => {
  const { task, current, grouped, original, filename, bytes } = await fixture(t)
  await fs.unlink(original)
  await fs.writeFile(path.join(current, filename), bytes)
  await fs.writeFile(path.join(grouped, filename), bytes)
  await assert.rejects(resolveDownloadFile(task, [grouped, current]), { code: 'AMBIGUOUS_FILE' })
})

test('directories, empty files and unsupported recorded paths do not silently fall back', async t => {
  const { task, current, original, filename, bytes } = await fixture(t)
  await fs.writeFile(path.join(current, filename), bytes)
  await fs.unlink(original)
  await fs.mkdir(original)
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'INVALID_FILE' })
  await fs.rmdir(original)
  await fs.writeFile(original, '')
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'INVALID_FILE' })
  task.metadata.filePath = original + '.wav'
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'UNSUPPORTED_FILE' })
})

test('permission errors remain permission errors and never select a different same-name file', async t => {
  const { task, current, original, filename, bytes } = await fixture(t)
  await fs.writeFile(path.join(current, filename), bytes)
  const access = fs.access.bind(fs)
  t.mock.method(fs, 'access', async(filePath, ...args) => {
    if (filePath === original) throw Object.assign(new Error('Denied'), { code: 'EACCES' })
    return access(filePath, ...args)
  })
  await assert.rejects(resolveDownloadFile(task, [current]), { code: 'EACCES' })
})

test('invalid fallback paths never select files outside the download directory', async t => {
  const { task, current } = await fixture(t)
  task.metadata.filePath = ''
  for (const fileName of ['../song.mp3', '..\\song.mp3', 'C:\\elsewhere\\song.mp3', '/elsewhere/song.mp3', 'bad\0.mp3', '']) {
    task.metadata.fileName = fileName
    await assert.rejects(resolveDownloadFile(task, [current]), { code: 'INVALID_PATH' })
  }
  task.metadata.fileName = 'song.mp3'
  await assert.rejects(resolveDownloadFile(task, ['', '.', 'relative', 'https://example.com/download']), { code: 'ENOENT' })
})

test('symlinks cannot be replaced through the tag editor', async t => {
  const { task, original, directory } = await fixture(t)
  const linked = path.join(directory, 'linked.mp3')
  try { await fs.symlink(original, linked, 'file') } catch (error) {
    if (error.code !== 'EPERM') throw error
    // Some Windows setups forbid creating file symlinks; still verify the rejection branch.
    const lstat = fs.lstat.bind(fs)
    t.mock.method(fs, 'lstat', async filename => filename === linked ? { isFile: () => false, isSymbolicLink: () => true } : lstat(filename))
  }
  task.metadata.filePath = linked
  await assert.rejects(resolveDownloadFile(task), { code: 'INVALID_FILE' })
  assert.equal((await readTags(original)).tags.title, 'Original')
})

test('a download restarted during a save cannot overwrite the original file', async t => {
  const { task, original, directory, bytes } = await fixture(t)
  const snapshot = await readTags(original)
  await assert.rejects(saveTags(snapshot, { title: 'Must not be written' }, async() => {
    task.status = 'run'
    await resolveDownloadFile(task)
  }), { code: 'DOWNLOAD_INCOMPLETE' })
  assert.deepEqual(await fs.readFile(original), bytes)
  assert.deepEqual((await fs.readdir(directory)).sort(), ['Downloads', path.basename(original)].sort())
})

test('deleting the file during save neither recreates it nor leaves a temporary replacement', async t => {
  const { original, directory } = await fixture(t)
  const snapshot = await readTags(original)
  await assert.rejects(saveTags(snapshot, { title: 'Must not be written' }, async() => fs.unlink(original)), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(directory), ['Downloads'])
})
