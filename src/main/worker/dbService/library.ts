import { createHash } from 'node:crypto'
import { getDB } from './db'
import { queryMusicInfoByListId } from './modules/list/dbHelper'
import { LIST_IDS } from '@common/constants'
import type { BackupLibrary } from '@common/backup'
import { emptyLibraryPreferences, validateLibraryPreferences, type LibraryPreferences, type HistoryVersion, type LibraryQuery, type ListeningQuery, type SmartRule } from '@common/library'

interface SongRow { id: string, name: string, singer: string, source: LX.Music.MusicInfo['source'], interval: string | null, meta: string }
const songFromRow = (row: SongRow): LX.Music.MusicInfo => ({ id: row.id, name: row.name, singer: row.singer, source: row.source, interval: row.interval, meta: JSON.parse(row.meta) })
const listSongs = (id: string) => queryMusicInfoByListId(id).map(songFromRow)
export const getLibraryPreferences = (): LibraryPreferences => {
  const row = getDB().prepare('SELECT value FROM library_preferences WHERE id=1').get() as { value: string } | undefined
  return row ? validateLibraryPreferences(JSON.parse(row.value)) : emptyLibraryPreferences()
}
export const saveLibraryPreferences = (data: LibraryPreferences) => {
  getDB().prepare('INSERT INTO library_preferences (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(validateLibraryPreferences(data)))
}
export const rememberLibrarySongs = (songs: LX.Music.MusicInfo[]) => {
  const statement = getDB().prepare('INSERT OR IGNORE INTO library_track (id,added_at) VALUES (?,?)')
  const now = Date.now()
  for (const song of songs) statement.run(song.id, now)
}

export const captureListHistory = (listId: string, reason = '修改前', songs?: LX.Music.MusicInfo[]) => {
  if (listId === LIST_IDS.TEMP) return
  const db = getDB()
  const items = songs ?? listSongs(listId)
  const payload = JSON.stringify(items)
  const hash = createHash('sha256').update(payload).digest('hex')
  const previous = db.prepare('SELECT hash FROM list_history WHERE list_id=? ORDER BY id DESC LIMIT 1').get(listId) as { hash: string } | undefined
  if (previous?.hash === hash) return
  db.transaction(() => {
    db.prepare('INSERT INTO list_history (list_id,created_at,reason,count,hash,payload) VALUES (?,?,?,?,?,?)').run(listId, Date.now(), reason, items.length, hash, payload)
    db.prepare('DELETE FROM list_history WHERE list_id=? AND id NOT IN (SELECT id FROM list_history WHERE list_id=? ORDER BY id DESC LIMIT 20)').run(listId, listId)
    // Limit both version count and UTF-8 snapshot bytes. Delete oldest first.
    const rows = db.prepare('SELECT id,length(CAST(payload AS BLOB)) AS bytes FROM list_history ORDER BY id DESC').all() as Array<{ id: number, bytes: number }>
    let bytes = 0
    const remove = db.prepare('DELETE FROM list_history WHERE id=?')
    rows.forEach((row, index) => { bytes += row.bytes; if (index >= 500 || (bytes > 128 * 1024 * 1024 && index > 0)) remove.run(row.id) })
  })()
}
export const getListHistory = (listId: string): HistoryVersion[] => getDB().prepare('SELECT id,list_id AS listId,created_at AS time,reason,count FROM list_history WHERE list_id=? ORDER BY id DESC LIMIT 20').all(listId) as HistoryVersion[]
export const getListHistoryDiff = (id: number) => {
  const version = getDB().prepare('SELECT list_id,payload FROM list_history WHERE id=?').get(id) as { list_id: string, payload: string } | undefined
  if (!version) throw Object.assign(new Error('这个歌单历史版本已被清理'), { code: 'HISTORY_NOT_FOUND' })
  const songs = JSON.parse(version.payload) as LX.Music.MusicInfo[]
  const current = listSongs(version.list_id)
  const before = new Map(songs.map((song, index) => [song.id, { song, index }]))
  const after = new Map(current.map((song, index) => [song.id, { song, index }]))
  const added = current.filter(song => !before.has(song.id))
  const removed = songs.filter(song => !after.has(song.id))
  const changed = current.filter(song => before.has(song.id) && JSON.stringify(before.get(song.id)!.song) !== JSON.stringify(song))
  const reordered = current.filter(song => before.has(song.id) && before.get(song.id)!.index !== after.get(song.id)!.index).length
  return { listId: version.list_id, songs, added, removed, changed, reordered }
}

export const recordListening = (song: LX.Music.MusicInfo, time = Date.now()) => {
  const db = getDB()
  db.transaction(() => {
    db.prepare('INSERT INTO library_track (id,added_at,last_played) VALUES (?,0,?) ON CONFLICT(id) DO UPDATE SET last_played=excluded.last_played').run(song.id, time)
    db.prepare('INSERT INTO listening_history (played_at,song_id,name,singer,payload) VALUES (?,?,?,?,?)').run(time, song.id, song.name, song.singer, JSON.stringify(song))
    db.prepare('DELETE FROM listening_history WHERE id < COALESCE((SELECT id FROM listening_history ORDER BY id DESC LIMIT 1 OFFSET 49999),0)').run()
  })()
}
export const getListeningHistory = (query: ListeningQuery = {}) => {
  const values = { from: query.from ?? 0, to: query.to ?? Date.now(), search: query.search?.trim() ?? '', offset: Math.max(0, Math.floor(query.page ?? 0)) * 50 }
  const where = 'played_at>=@from AND played_at<=@to AND (@search=\'\' OR instr(lower(name || \' \' || singer),lower(@search))>0)'
  const db = getDB()
  const rows = db.prepare(`SELECT id,played_at AS time,payload FROM listening_history WHERE ${where} ORDER BY played_at DESC,id DESC LIMIT 50 OFFSET @offset`).all(values) as Array<{ id: number, time: number, payload: string }>
  const stats = db.prepare(`SELECT count(*) AS plays,count(DISTINCT song_id) AS songs,count(DISTINCT singer) AS singers FROM listening_history WHERE ${where}`).get(values) as { plays: number, songs: number, singers: number }
  const artists = db.prepare(`SELECT singer,count(*) AS count FROM listening_history WHERE ${where} GROUP BY singer ORDER BY count DESC LIMIT 5`).all(values) as Array<{ singer: string, count: number }>
  return { rows: rows.map(({ id, time, payload }) => ({ id, time, song: JSON.parse(payload) as LX.Music.MusicInfo })), stats, artists }
}
export const clearListeningHistory = () => {
  getDB().transaction(() => {
    getDB().prepare('DELETE FROM listening_history').run()
    getDB().prepare('UPDATE library_track SET last_played=0').run()
  })()
}

const uniqueSongs = 'm.rowid=(SELECT min(duplicate.rowid) FROM my_list_music_info duplicate WHERE duplicate.id=m.id)'
export const getLibraryCatalog = (query: LibraryQuery = {}) => {
  const db = getDB()
  const params = { search: query.search?.trim() ?? '', singer: query.singer ?? null, album: query.album ?? null, year: query.year ?? '', missing: query.missing ? 1 : 0, offset: Math.max(0, Math.floor(query.page ?? 0)) * 50 }
  const where = `m.source='local' AND ${uniqueSongs} AND (@search='' OR instr(lower(m.name || ' ' || m.singer || ' ' || COALESCE(json_extract(m.meta,'$.albumName'),'')),lower(@search))>0) AND (@singer IS NULL OR m.singer=@singer) AND (@album IS NULL OR COALESCE(json_extract(m.meta,'$.albumName'),'')=@album) AND (@year='' OR CAST(COALESCE(json_extract(m.meta,'$.year'),'未知') AS TEXT)=@year) AND (@missing=0 OR t.missing=1)`
  const from = 'FROM my_list_music_info m LEFT JOIN library_track t ON m.id=t.id'
  const rows = db.prepare(`SELECT m.*,COALESCE(t.missing,0) AS missing ${from} WHERE ${where} ORDER BY m.singer,m.name,m.id LIMIT 50 OFFSET @offset`).all(params) as Array<SongRow & { missing: number }>
  const { count } = db.prepare(`SELECT count(*) AS count ${from} WHERE ${where}`).get(params) as { count: number }
  return { songs: rows.map(row => ({ song: songFromRow(row), missing: !!row.missing })), count }
}
export const getLibraryFacets = () => {
  const db = getDB()
  const fields = { singers: 'm.singer', albums: "COALESCE(json_extract(m.meta,'$.albumName'),'')", years: "CAST(COALESCE(json_extract(m.meta,'$.year'),'未知') AS TEXT)" }
  return Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, db.prepare(`SELECT ${field} AS value,count(*) AS count FROM my_list_music_info m WHERE m.source='local' AND ${uniqueSongs} GROUP BY value ORDER BY value`).all()])) as Record<keyof typeof fields, Array<{ value: string, count: number }>>
}
export const getLibraryLocalFiles = () => (getDB().prepare(`SELECT m.* FROM my_list_music_info m WHERE m.source='local' AND ${uniqueSongs}`).all() as SongRow[]).map(songFromRow) as LX.Music.MusicInfoLocal[]
export const setLibraryFileStatus = (items: Array<{ id: string, missing: boolean }>) => {
  getDB().transaction(() => {
    const statement = getDB().prepare('INSERT INTO library_track (id,added_at,missing) VALUES (?,0,?) ON CONFLICT(id) DO UPDATE SET missing=excluded.missing')
    for (const item of items) statement.run(item.id, item.missing ? 1 : 0)
  })()
}
export const getSmartPlaylist = (rule: SmartRule, excludeList = '') => {
  const db = getDB()
  const smartLists = JSON.stringify([...Object.entries(getLibraryPreferences().lists).filter(([, config]) => config.smart).map(([id]) => id), excludeList, LIST_IDS.TEMP])
  const conditions = ['m.listId NOT IN (SELECT value FROM json_each(@smartLists))', rule.sourceList ? 'm.listId=@list' : 'm.rowid=(SELECT min(duplicate.rowid) FROM my_list_music_info duplicate WHERE duplicate.id=m.id AND duplicate.listId NOT IN (SELECT value FROM json_each(@smartLists)))']
  if (rule.kind === 'recent') conditions.push('t.added_at>=@cutoff')
  else if (rule.kind === 'unplayed') conditions.push('COALESCE(t.last_played,0)<@cutoff')
  else conditions.push("EXISTS (SELECT 1 FROM download_list d WHERE d.isComplate=1 AND json_extract(d.musicInfo,'$.id')=m.id)")
  const rows = db.prepare(`SELECT m.* FROM my_list_music_info m LEFT JOIN library_track t ON t.id=m.id WHERE ${conditions.join(' AND ')} ORDER BY ${rule.kind === 'recent' ? 't.added_at DESC' : 'COALESCE(t.last_played,0)'},m.name,m.id`).all({ list: rule.sourceList, smartLists, cutoff: Date.now() - rule.days * 86400000 }) as SongRow[]
  return rows.map(songFromRow)
}

export const getDatabaseCacheSizes = () => {
  const db = getDB()
  const size = (sql: string) => (db.prepare(sql).get() as { bytes: number }).bytes
  return {
    lyrics: size("SELECT COALESCE(sum(length(CAST(id||text AS BLOB))),0) AS bytes FROM lyric WHERE source='raw'"),
    urls: size('SELECT COALESCE(sum(length(CAST(id||url AS BLOB))),0) AS bytes FROM music_url'),
    sources: size('SELECT COALESCE(sum(length(CAST(source_id||id||name||singer||meta AS BLOB))),0) AS bytes FROM music_info_other_source'),
  }
}

export const readLibraryBackup = (): BackupLibrary => {
  const db = getDB()
  const versions = db.prepare('SELECT list_id AS listId,created_at AS time,reason,payload FROM list_history ORDER BY id').all() as Array<{ listId: string, time: number, reason: string, payload: string }>
  const listening = db.prepare('SELECT played_at AS time,payload FROM listening_history ORDER BY id').all() as Array<{ time: number, payload: string }>
  return { preferences: getLibraryPreferences(), versions: versions.map(({ payload, ...row }) => ({ ...row, songs: JSON.parse(payload) })), listening: listening.map(({ time, payload }) => ({ time, song: JSON.parse(payload) })), tracks: db.prepare('SELECT * FROM library_track').all() as BackupLibrary['tracks'] }
}
export const restoreLibraryBackup = (data: BackupLibrary) => {
  const db = getDB()
  db.transaction(() => {
    saveLibraryPreferences({ ...data.preferences, folders: data.preferences.folders.map(folder => ({ ...folder, enabled: false })) })
    db.prepare('DELETE FROM list_history').run()
    db.prepare('DELETE FROM listening_history').run()
    db.prepare('DELETE FROM library_track').run()
    const version = db.prepare('INSERT INTO list_history (list_id,created_at,reason,count,hash,payload) VALUES (?,?,?,?,?,?)')
    for (const item of data.versions) { const payload = JSON.stringify(item.songs); version.run(item.listId, item.time, item.reason, item.songs.length, createHash('sha256').update(payload).digest('hex'), payload) }
    const history = db.prepare('INSERT INTO listening_history (played_at,song_id,name,singer,payload) VALUES (?,?,?,?,?)')
    for (const item of data.listening) history.run(item.time, item.song.id, item.song.name, item.song.singer, JSON.stringify(item.song))
    const track = db.prepare('INSERT INTO library_track (id,added_at,last_played,missing) VALUES (@id,@added_at,@last_played,@missing)')
    for (const item of data.tracks) track.run(item)
  })()
}
