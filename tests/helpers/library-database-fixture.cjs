const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const loader = require('./load-typescript.cjs')
const { song, task } = require('./webdav-fixture.cjs')
const db = new Database(':memory:')
const load = loader({ crypto: require('node:crypto'), './db': { getDB: () => db }, '../../db': { getDB: () => db }, '@common/utils/nodejs': {} })
const tables = load('src/main/worker/dbService/tables.ts')
const mode = process.argv[2]
try {
  if (mode === 'migration') {
    for (const [name, sql] of tables.default) {
      if (name === 'index_download_music_id' || name.startsWith('library_') || name.startsWith('listening_') || name.startsWith('index_listening_') || name.startsWith('list_history') || name.startsWith('index_list_history') || Object.hasOwn(tables.QUERY_INDEXES, name)) continue
      db.exec(name === 'list_trash' ? sql.replace('"summary" TEXT NOT NULL DEFAULT \'{}\',', '') : sql)
    }
    db.prepare('INSERT INTO db_info (field_name,field_value) VALUES (?,?)').run('version', '5')
    db.prepare('INSERT INTO list_trash (id,deleted_at,expires_at,payload) VALUES (?,?,?,?)').run('trash', 1, Date.now() + 999999, JSON.stringify({ kind: 'songs', list: { id: 'default', name: 'Default' }, songs: [{ musicInfo: song('old') }] }))
    db.prepare('INSERT INTO lyric (id,source,type,text) VALUES (?,?,?,?)').run('song', 'edited', 'lyric', 'keep')
    load('src/main/worker/dbService/migrate.ts').default(db)
    assert.equal(load('src/main/worker/dbService/verifyDB.ts').default(db), true)
    assert.equal(db.prepare('SELECT text FROM lyric').get().text, 'keep')
    assert.equal(JSON.parse(db.prepare('SELECT summary FROM list_trash').get().summary).count, 1)
    load('src/main/worker/dbService/migrate.ts').default(db)
    assert.equal(db.prepare('SELECT field_value FROM db_info').get().field_value, '7')
  } else {
    db.exec([...tables.default.values()].join('\n'))
    const list = load('src/main/worker/dbService/modules/list/index.ts')
    const library = load('src/main/worker/dbService/library.ts')
    const download = load('src/main/worker/dbService/modules/download/index.ts')
    if (mode === 'indexes') {
      for (const sql of ["SELECT * FROM lyric WHERE id='a' AND source='raw'", "SELECT * FROM lyric WHERE source='raw'", "SELECT * FROM my_list_music_info WHERE listId='a'", "SELECT * FROM my_list_music_info_order WHERE listId='a' ORDER BY `order`", 'SELECT * FROM my_list ORDER BY position', 'SELECT id FROM list_trash ORDER BY deleted_at DESC']) {
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join('\n')
        assert.match(plan, /USING (COVERING )?INDEX/, sql + '\n' + plan)
        assert.doesNotMatch(plan, /TEMP B-TREE/, sql + '\n' + plan)
      }
      load('src/main/worker/dbService/statementCache.ts').cacheStatements(db, 3)
      const one = db.prepare('SELECT 1')
      assert.equal(db.prepare('SELECT 1'), one)
      db.prepare('SELECT 2'); db.prepare('SELECT 3'); db.prepare('SELECT 4')
      assert.notEqual(db.prepare('SELECT 1'), one)
      const iterate = db.prepare('SELECT 5 UNION ALL SELECT 6')
      const iterator = iterate.iterate(); iterator.next()
      assert.notEqual(db.prepare('SELECT 5 UNION ALL SELECT 6'), iterate)
      iterator.return()
    } else if (mode === 'history') {
      list.createUserLists(0, [{ id: 'test', name: 'Test', locationUpdateTime: null }])
      list.musicsAdd('test', [song('a'), song('b')], 'bottom')
      library.captureListHistory('test', 'manual')
      const version = library.getListHistory('test')[0]
      list.musicsRemove('test', ['wy_a'])
      list.musicsAdd('test', [song('c')], 'bottom')
      const diff = library.getListHistoryDiff(version.id)
      assert.deepEqual(diff.added.map(item => item.id), ['wy_c'])
      assert.deepEqual(diff.removed.map(item => item.id), ['wy_a'])
      list.musicOverwrite('test', diff.songs)
      assert.deepEqual(list.getListMusics('test').map(item => item.id), ['wy_a', 'wy_b'])
      for (let i = 0; i < 30; i++) list.musicsAdd('test', [song('x' + i)], 'bottom')
      assert.equal(library.getListHistory('test').length, 20)
      // No payload is fetched or parsed while listing trash summaries.
      list.musicsRemove('test', ['wy_a'], true)
      db.prepare("UPDATE list_trash SET payload='broken'").run()
      assert.equal(list.getListTrash()[0].count, 1)
    } else if (mode === 'catalog') {
      const local = { id: 'local', name: 'Local', singer: 'Artist', source: 'local', interval: '03:00', meta: { songId: 'local', filePath: 'C:/music.wav', albumName: 'Album', year: 2024, ext: 'wav' } }
      list.musicsAdd('default', [local, song('online')], 'bottom')
      list.musicsAdd('love', [local], 'bottom')
      library.setLibraryFileStatus([{ id: 'local', missing: true }])
      assert.equal(library.getLibraryCatalog({ missing: true, year: '2024', singer: 'Artist' }).count, 1)
      assert.equal(library.getLibraryCatalog({ year: '2025' }).count, 0)
      assert.deepEqual(library.getLibraryFacets().albums, [{ value: 'Album', count: 1 }])
      library.recordListening(local, 1000); library.recordListening(local, 2000); library.recordListening(song('online'), 3000)
      assert.equal(library.getListeningHistory({ from: 1500, to: 2500, search: 'Artist' }).stats.plays, 1)
      assert.equal(library.getListeningHistory().stats.plays, 3)
      assert.equal(library.getListeningHistory().stats.songs, 2)
      const prefs = { lists: { test: { folder: 'Daily', tags: ['study'], pinned: true } }, folders: [] }
      library.saveLibraryPreferences(prefs); assert.deepEqual(library.getLibraryPreferences(), prefs)
      assert.throws(() => library.saveLibraryPreferences({ lists: {}, folders: [null] }))
      const recent = library.getSmartPlaylist({ kind: 'recent', days: 7, sourceList: 'default' })
      assert.equal(recent.length, 2)
      const unknown = { ...local, id: 'unknown', name: 'No tags', singer: '', meta: { ...local.meta, songId: 'unknown', albumName: undefined, year: undefined } }
      list.musicsAdd('default', [unknown], 'bottom')
      assert.equal(library.getLibraryCatalog({ search: 'No tags' }).count, 1)
      assert.equal(library.getLibraryCatalog({ singer: '', album: '' }).songs[0].song.id, 'unknown')
      assert.equal(library.getLibraryCatalog({}).count, 2)
      assert.deepEqual(library.getLibraryFacets().albums, [{ value: '', count: 1 }, { value: 'Album', count: 1 }])
      download.downloadListReplace([task('online', true)])
      assert.equal(library.getSmartPlaylist({ kind: 'downloaded', days: 1, sourceList: '' }).length, 1)
      const backup = library.readLibraryBackup()
      library.restoreLibraryBackup(backup)
      assert.deepEqual(library.readLibraryBackup(), backup)
      library.clearListeningHistory(); assert.equal(library.getListeningHistory().stats.plays, 0)
    } else throw Error('Unknown scenario')
  }
  console.log('PASS ' + mode)
} finally { db.close() }
