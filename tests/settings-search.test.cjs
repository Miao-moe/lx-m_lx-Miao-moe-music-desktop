const assert = require('node:assert/strict')
const { test } = require('node:test')
const load = require('./helpers/load-typescript.cjs')()
const { normalizeSearchText, searchTerms, createSearchIndex, matchSearchIndex } = load('src/renderer/views/Setting/search.ts')

test('settings search normalizes full-width, invisible characters, case and whitespace', () => {
  assert.equal(normalizeSearchText(' \u200bＷｅｂＤＡＶ　 Cookie\n '), 'webdav cookie')
  assert.deepEqual(searchTerms('背景  按钮 背景'), ['背景', '按钮'])
})

test('multiple words must match one setting, allowing category names and either word order', () => {
  const index = createSearchIndex([{ id: 'advanced', title: '高级', prefixes: ['setting__advanced'] }], {
    setting__advanced: ['高级', 'Advanced'],
    setting__advanced_background: ['动态背景', 'Dynamic background'],
    setting__advanced_background_contrast: ['按钮跟随背景变色', 'Adaptive buttons'],
    setting__advanced_play: ['无缝播放', 'Gapless playback'],
  })
  for (const query of ['背景 按钮', '按钮 背景', 'Advanced 按钮']) {
    assert.deepEqual(matchSearchIndex(index, query).get('advanced').keys, ['setting__advanced_background_contrast'])
  }
  assert.equal(matchSearchIndex(index, '无缝 背景').size, 0)
  assert.equal(matchSearchIndex(index, '  ').size, 0)
  assert.equal(matchSearchIndex(index, '高级').get('advanced').full, true)
  assert.equal(matchSearchIndex(index, '[').size, 0)
})

test('explicit keys, locale fallback, dynamic names and platform exclusions share one index', () => {
  const index = createSearchIndex([
    { id: 'search', title: 'Search', prefixes: ['setting__search', 'setting__odc_clear_search'] },
    { id: 'play', title: 'Playback', prefixes: ['setting__play'], excludes: ['setting__play_statusbar_lyric'] },
    { id: 'download', title: 'Downloads', prefixes: ['setting__download'], keys: ['setting_download_save_group_list_name'] },
    { id: 'plugins', title: 'Plugins', prefixes: [], entries: [{ key: 'card:test', text: '测试插件 Test Plugin' }] },
  ], {
    setting__odc_clear_search_input: ['离开时清空搜索框'],
    setting__play_statusbar_lyric: ['菜单栏歌词'],
    setting__play_statusbar_lyric_tip: ['菜单栏提示'],
    setting_download_save_group_list_name: ['以列表命名的子目录'],
  })
  assert.deepEqual([...matchSearchIndex(index, '清空').keys()], ['search'])
  assert.equal(matchSearchIndex(index, '菜单栏').size, 0)
  assert.deepEqual([...matchSearchIndex(index, '子目录').keys()], ['download'])
  assert.deepEqual(matchSearchIndex(index, 'test plugin').get('plugins').keys, ['card:test'])
})

test('common synonyms lead to actual settings, without leaking adjacent prefixes', () => {
  const index = createSearchIndex([{ id: 'basic', title: '基本设置', prefixes: ['setting__basic'] }], {
    setting__basic_theme: ['主题颜色'],
    setting__basic_source: ['自定义源'],
    setting__basicness: ['不应匹配'],
  })
  assert.deepEqual(matchSearchIndex(index, '夜间模式').get('basic').keys, ['setting__basic_theme'])
  assert.deepEqual(matchSearchIndex(index, '音源').get('basic').keys, ['setting__basic_source'])
  assert.equal(matchSearchIndex(index, '不应匹配').size, 0)
})
