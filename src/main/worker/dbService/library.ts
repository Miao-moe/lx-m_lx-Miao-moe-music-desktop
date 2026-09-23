import { createHash } from 'node:crypto'
import { getDB } from './db'
import type { BackupLibrary } from '@common/backup'
import { emptyLibraryPreferences, validateLibraryPreferences, type LibraryPreferences, type ListeningQuery } from '@common/library'

export const getLibraryPreferences = (): LibraryPreferences => {
  const row = getDB().prepare('SELECT value FROM library_preferences WHERE id=1').get() as { value: string } | undefined
  return row ? validateLibraryPreferences(JSON.parse(row.value)) : emptyLibraryPreferences()
}
export const saveLibraryPreferences = (data: LibraryPreferences) => {
  getDB().prepare('INSERT INTO library_preferences (id,value) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(validateLibraryPreferences(data)))
}

export const recordListening = (song: LX.Music.MusicInfo, time = Date.now()) => {
  const db = getDB()
  db.transaction(() => {
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
  getDB().prepare('DELETE FROM listening_history').run()
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
