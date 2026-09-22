const assert = require('node:assert/strict')
const { test } = require('node:test')
const { filterSearchSongs, getSearchVersion } = require('./helpers/load-typescript.cjs')()('src/renderer/utils/searchMusicFilter.ts')
const song = (id, source, name = 'A Song', singer = 'Artist', interval = '03:00') => ({ id, source, name, singer, interval })

test('B22: explicit version markers distinguish live, accompaniment, covers and standard recordings', () => {
  for (const [name, kind] of [['Song (Live)', 'live'], ['Song（伴奏）', 'instrumental'], ['Song [Cover]', 'cover'], ['Song - Remix', 'remix'], ['Song (Acoustic)', 'acoustic'], ['Song (Sped Up)', 'other'], ['Live Forever', 'standard']]) assert.equal(getSearchVersion(name), kind)
  assert.deepEqual(filterSearchSongs([song('a', 'kw'), song('b', 'tx', 'A Song (Live)')], 'live').list.map(item => item.id), ['b'])
})
test('B22: cross-platform grouping is reversible and preserves different artists, versions and durations', () => {
  const songs = [song('a', 'kw'), song('b', 'tx', 'Ａ Song!'), song('live', 'wy', 'A Song (Live)'), song('cover', 'kg', 'A Song', 'Other Artist'), song('long', 'mg', 'A Song', 'Artist', '03:12'), song('unknown', 'wy', 'A Song', 'Artist', null)]
  const result = filterSearchSongs(songs, 'all', true)
  assert.deepEqual(result.list.map(item => item.id), ['a', 'live', 'cover', 'long', 'unknown'])
  assert.equal(result.mergedCount, 1)
  assert.equal(result.sourceLabels.a, 'kw / tx')
  assert.equal(filterSearchSongs(songs).list.length, 6)
  assert.equal(songs[1].name, 'Ａ Song!')
  const playable = filterSearchSongs(songs, 'all', true, song => song.source === 'tx')
  assert.equal(playable.list[0].id, 'b', 'the group retains a playable platform when the first result is unsupported')
  assert.equal(playable.sourceLabels.b, 'tx / kw')
})
