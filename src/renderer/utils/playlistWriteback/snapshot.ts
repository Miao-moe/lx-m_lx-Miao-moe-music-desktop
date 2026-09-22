import type { LocalPlaylist, Snapshot, Track, WritebackSource } from './types'

export const isWritebackSupported = (list: LX.List.UserListInfo) => {
  return !!list.source && ['wy', 'tx', 'kg', 'mg'].includes(list.source) && /^\d+$/.test(list.sourceListId ?? '')
}

export const localPlaylistSnapshot = (list: LX.List.UserListInfo, songs: LX.Music.MusicInfo[]): LocalPlaylist | null => {
  if (!isWritebackSupported(list)) return null
  const source = list.source as WritebackSource
  const tracks: Track[] = []
  const seen = new Set<string>()
  let ignored = 0
  for (const song of songs) {
    if (song.source !== source) { ignored++; continue }
    let track: Track
    if (song.source === 'kg') {
      track = { key: song.meta.hash?.toLowerCase(), hash: song.meta.hash, name: `${song.singer} - ${song.name}`, albumId: String(song.meta.albumId ?? 0) }
    } else if (song.source === 'tx') {
      track = { key: String(song.meta.songId), songId: song.meta.id == null ? undefined : String(song.meta.id), songType: song.meta.songType ?? 0 }
    } else if (song.source === 'mg') {
      track = { key: String(song.meta.songId), songId: String(song.meta.songId), contentId: song.meta.contentId, copyrightId: song.meta.copyrightId }
    } else track = { key: String(song.meta.songId), songId: String(song.meta.songId) }
    if (!track.key || track.key === 'undefined') { ignored++; continue }
    track.name ??= `${song.name} · ${song.singer}`
    if (!seen.has(track.key)) { tracks.push(track); seen.add(track.key) }
  }
  const name = /^userlist_(wy|tx|kg|mg)_sync_/.test(list.id) ? list.name.replace(/^(网易云音乐|QQ 音乐|酷狗音乐|咪咕音乐) - /, '') : list.name
  const snapshot: Snapshot = {
    name,
    tracks,
    ignored,
    fingerprint: JSON.stringify([list.name, songs.map(song => [song.source, song.id, song.meta.songId])]),
  }
  return { source, remoteId: list.sourceListId!, snapshot }
}
