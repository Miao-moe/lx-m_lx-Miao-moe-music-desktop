const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const iconv = require('iconv-lite')
const loader = require('./helpers/load-typescript.cjs')

const lyric = { lyric: '[00:01.00]新的歌词' }
const options = (filePath, format = 'utf8') => ({ filePath, format, downloadLxlrc: false, downloadTlrc: false, downloadRlrc: false })
const saveLrc = (filesystem = fs) => loader({
  '@common/constants': { DOWNLOAD_STATUS: {}, QUALITYS: [] },
  '@common/utils/download/fileName': { formatDownloadFileName: () => '' },
  './lrcTool': { buildLyrics: data => data.lyric },
  'iconv-lite': iconv,
  'node:fs/promises': filesystem,
})('src/renderer/worker/download/utils.ts').saveLrc

const directory = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lx-download-lrc-'))
  t.after(async() => {
    const resolved = await fs.realpath(root)
    const tempRoot = await fs.realpath(os.tmpdir())
    assert.equal(path.dirname(resolved).toLowerCase(), tempRoot.toLowerCase())
    assert(path.basename(resolved).startsWith('lx-download-lrc-'))
    await fs.rm(resolved, { recursive: true, force: true })
  })
  return root
}

test('C16: completed UTF-8 and GBK lyrics replace the target without leaving temporary files', async t => {
  const root = await directory(t), file = path.join(root, 'song.lrc')
  await fs.writeFile(file, 'old lyrics')
  for (const format of ['utf8', 'gbk']) {
    await saveLrc()(lyric, options(file, format))
    assert.deepEqual(await fs.readFile(file), iconv.encode(lyric.lyric, format, { addBOM: true }))
    assert.deepEqual(await fs.readdir(root), ['song.lrc'])
  }
})

test('C16: an interrupted write keeps the old lyric and does not create a partial new lyric', async t => {
  const root = await directory(t), existing = path.join(root, 'song.lrc'), missing = path.join(root, 'new.lrc')
  await fs.writeFile(existing, 'old lyrics')
  const interrupted = {
    ...fs,
    open: async(...args) => {
      const file = await fs.open(...args)
      return {
        writeFile: async data => {
          await file.writeFile(data.subarray(0, 4))
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        },
        sync: () => file.sync(),
        close: () => file.close(),
      }
    },
  }
  for (const target of [existing, missing]) await assert.rejects(saveLrc(interrupted)(lyric, options(target)), { code: 'ENOSPC' })
  assert.equal(await fs.readFile(existing, 'utf8'), 'old lyrics')
  await assert.rejects(fs.stat(missing), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(root), ['song.lrc'])
})

test('C16: a failed replacement preserves the original and removes the temporary file', async t => {
  const root = await directory(t), file = path.join(root, 'song.lrc')
  await fs.writeFile(file, 'old lyrics')
  const locked = { ...fs, rename: async() => { throw Object.assign(new Error('locked'), { code: 'EPERM' }) } }
  await assert.rejects(saveLrc(locked)(lyric, options(file)), { code: 'EPERM' })
  assert.equal(await fs.readFile(file, 'utf8'), 'old lyrics')
  assert.deepEqual(await fs.readdir(root), ['song.lrc'])
})
