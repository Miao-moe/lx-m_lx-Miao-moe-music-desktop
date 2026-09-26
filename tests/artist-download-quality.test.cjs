const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const singer = loader({
  './utils/index': {},
  '../../index': { formatPlayTime: seconds => String(seconds), sizeFormate: bytes => `${bytes}B` },
  '../utils': { formatSingerName: artists => artists.map(artist => artist.name).join('、') },
})('src/renderer/utils/musicSdk/wy/singer.js').default
const { getDownloadQualityOptions, mergeMatchedSearchQuality, shouldRefreshDownloadQuality } = loader()('src/renderer/components/common/downloadQuality.js')
const { getMusicType } = loader({
  '@common/constants': { QUALITYS: ['master', 'atmos_plus', 'atmos', 'hires', 'flac24bit', 'flac', '320k', '128k'] },
  './lrcTool': {},
  '@common/utils/atomicFile': {},
  '@common/utils/download/fileName': {},
})('src/renderer/worker/download/utils.ts')
const sourceQualitys = ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']

const artistSong = rates => ({
  id: 101,
  name: 'Artist song',
  artists: [{ name: 'Artist' }],
  album: { id: 2, name: 'Album' },
  dt: 180000,
  privilege: { chargeInfoList: rates.map(rate => ({ rate })) },
  lMusic: { size: 100 },
  hMusic: { size: 200 },
  sqMusic: { size: 300 },
  hrMusic: { size: 400 },
})
const onlineSong = (qualitys, source = 'wy') => ({ source, meta: { qualitys, _qualitys: {} } })
const types = qualitys => qualitys.map(quality => quality.type)

test('artist songs advertise each reported quality once, without switch fallthrough', () => {
  const [one] = singer.filterSongList([artistSong([128000])])
  assert.deepEqual(types(one.types), ['128k'])
  assert.deepEqual(Object.keys(one._types), ['128k'])
  assert.deepEqual(types(getDownloadQualityOptions(onlineSong(one.types), sourceQualitys)), ['128k'])

  const [several] = singer.filterSongList([artistSong([128000, 320000, 999000, 1999000, 320000, 192000, 400000])])
  assert.deepEqual(types(several.types), ['128k', '320k', 'flac', 'flac24bit'])
  assert.deepEqual(Object.keys(several._types), ['128k', '320k', 'flac', 'flac24bit'])
})

test('previously saved artist lists recover the actual rates from the old repeated sequence', () => {
  const oldQualitys = ['128k', '320k', 'flac', 'flac24bit', '320k', 'flac', 'flac24bit']
    .map(type => ({ type, size: null }))
  const info = onlineSong(oldQualitys)
  info.meta._qualitys = Object.fromEntries(oldQualitys.map(({ type }) => [type, { size: null }]))
  assert.deepEqual(types(getDownloadQualityOptions(info, sourceQualitys)), ['128k', '320k'])
  assert.deepEqual(types(info.meta.qualitys), types(oldQualitys), 'opening the modal must not change saved list data')
})

test('download choices do not invent intermediate qualities or repeat a quality', () => {
  assert.deepEqual(types(getDownloadQualityOptions(onlineSong([{ type: '320k', size: '2B' }]), sourceQualitys)), ['320k'])
  assert.deepEqual(types(getDownloadQualityOptions(onlineSong([
    { type: '320k', size: null }, { type: '320k', size: '2B' },
  ], 'tx'), sourceQualitys)), ['320k'])
  assert.deepEqual(getDownloadQualityOptions(onlineSong([
    { type: '320k', size: null }, { type: '320k', size: '2B' },
  ], 'tx'), sourceQualitys)[0].size, '2B')
  assert.deepEqual(types(getDownloadQualityOptions(onlineSong([{ type: 'flac24bit', size: '4B' }]), sourceQualitys)), ['flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'])
})

test('extended download choices use their own reported sizes', () => {
  const info = onlineSong([{ type: 'flac24bit', size: '4 MB' }])
  info.meta._qualitys = {
    flac24bit: { size: '4 MB' },
    hires: { size: '8 MB' },
    atmos: { size: '9 MB' },
    master: { size: '12 MB' },
  }
  const sizes = Object.fromEntries(getDownloadQualityOptions(info, sourceQualitys).map(({ type, size }) => [type, size]))
  assert.equal(sizes.hires, '8 MB')
  assert.equal(sizes.atmos, '9 MB')
  assert.equal(sizes.master, '12 MB')
  assert.equal(sizes.atmos_plus, null)
})

test('playlist downloads use matching search metadata for every quality through Master', () => {
  const info = { ...onlineSong([{ type: '128k', size: '1B' }, { type: 'flac', size: '3B' }]), id: 'wy_101', name: 'Same song' }
  info.meta._qualitys = { '128k': { size: '1B' }, flac: { size: '3B' } }
  assert.equal(shouldRefreshDownloadQuality(info, sourceQualitys, 'my-list'), true)
  assert.equal(shouldRefreshDownloadQuality(info, sourceQualitys, ''), false)
  assert.deepEqual(types(getDownloadQualityOptions(info, sourceQualitys)), ['128k', 'flac'], 'do not infer unsupported tiers from FLAC alone')

  const searched = {
    ...info,
    meta: {
      qualitys: [{ type: '128k', size: '1B' }, { type: 'flac', size: '3B' }, { type: 'flac24bit', size: '5B' }],
      _qualitys: { '128k': { size: '1B' }, flac: { size: '3B' }, flac24bit: { size: '5B' } },
    },
  }
  assert.equal(mergeMatchedSearchQuality(info, [{ ...searched, id: 'wy_999' }]), info, 'a different song must not change the choices')
  const enriched = mergeMatchedSearchQuality(info, [searched])
  assert.deepEqual(types(getDownloadQualityOptions(enriched, sourceQualitys)), ['128k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'])
  for (const quality of ['flac24bit', 'hires', 'atmos', 'atmos_plus', 'master']) {
    assert.equal(getMusicType(enriched, quality, { wy: sourceQualitys }), quality, `${quality} must reach the download worker unchanged`)
  }
  assert.deepEqual(types(getDownloadQualityOptions(info, sourceQualitys)), ['128k', 'flac'], 'search must not mutate the saved playlist entry')
})
