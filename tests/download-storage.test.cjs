const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { downloadLimitBytes, parseDownloadSize, estimateDownloadTask, summarizeDownloadStorage } = load('src/common/utils/download/storage.ts')
const { getDownloadDiskSpace } = load('src/main/utils/diskSpace.ts')

const task = (quality, size, interval = '03:00') => ({
  metadata: {
    quality,
    musicInfo: { interval, meta: { qualitys: size == null ? [] : [{ type: quality, size }], _qualitys: {} } },
  },
})

test('C20: parses reported sizes and separates exact, bitrate-estimated and unknown files', () => {
  assert.equal(parseDownloadSize('3.5M'), 3.5 * 1024 * 1024)
  assert.equal(parseDownloadSize('1.25 GiB'), 1.25 * 1024 ** 3)
  assert.equal(parseDownloadSize('bad'), null)
  assert.deepEqual(estimateDownloadTask(task('flac', '50M')), { bytes: 50 * 1024 ** 2, approximate: false })
  assert.deepEqual(estimateDownloadTask(task('320k', null)), { bytes: Math.ceil(180 * 320000 / 8 * 1.03), approximate: true })
  assert.deepEqual(estimateDownloadTask(task('flac', null)), { bytes: null, approximate: false })
})

test('C20: preflight detects each configured limit and available disk shortage', () => {
  const mib = 1024 ** 2
  const list = [task('flac', '20M'), task('flac', '30M'), task('flac', null)]
  const summary = summarizeDownloadStorage(list, 25 * mib, 45 * mib, 40 * mib)
  assert.deepEqual(summary, {
    knownBytes: 50 * mib,
    knownCount: 2,
    approximateCount: 0,
    unknownCount: 1,
    overTaskCount: 1,
    overBatch: true,
    insufficientDisk: true,
  })
  assert.equal(downloadLimitBytes(25), 25 * mib)
  assert.equal(downloadLimitBytes(0), 0)
  assert.equal(downloadLimitBytes(Number.NaN), 0)
})

test('C20: free-space lookup uses an existing parent for a new download directory', async() => {
  const result = await getDownloadDiskSpace(path.join(os.tmpdir(), 'lx-c20-new-download-folder', 'music'))
  assert(result.totalBytes > 0)
  assert(result.availableBytes > 0)
  assert(result.availableBytes <= result.totalBytes)
})
