export const SYNC_DIFF_PLAYLIST_SCOPE = '歌单'
export const SYNC_DIFF_SONG_ORDER = '歌曲顺序'
export const SYNC_DIFF_ORDER_CHANGED = '顺序已改变'

export interface SyncDifference { kind: 'added' | 'removed' | 'renamed' | 'changed', scope: string, before: string, after: string, scopeKind?: 'playlist', detailKind?: 'order' }
export interface SyncDiff { changes: SyncDifference[], total: number }
export const playlistDiff = (before: LX.Sync.List.ListData, after: LX.Sync.List.ListData): SyncDiff => {
  const all = (data: LX.Sync.List.ListData) => [{ id: 'default', name: '默认列表', list: data.defaultList }, { id: 'love', name: '我的收藏', list: data.loveList }, ...data.userList]
  const left = new Map(all(before).map(list => [list.id, list]))
  const right = new Map(all(after).map(list => [list.id, list]))
  const result: SyncDiff = { changes: [], total: 0 }
  const add = (value: SyncDifference) => { result.total++; if (result.changes.length < 100) result.changes.push(value) }
  for (const [id, list] of left) {
    const next = right.get(id)
    if (!next) { add({ kind: 'removed', scope: SYNC_DIFF_PLAYLIST_SCOPE, scopeKind: 'playlist', before: list.name, after: '' }); continue }
    if (list.name !== next.name) add({ kind: 'renamed', scope: SYNC_DIFF_PLAYLIST_SCOPE, scopeKind: 'playlist', before: list.name, after: next.name })
    const oldSongs = new Map(list.list.map(song => [song.id, song]))
    const newSongs = new Map(next.list.map(song => [song.id, song]))
    for (const [key, song] of oldSongs) if (!newSongs.has(key)) add({ kind: 'removed', scope: list.name, before: `${song.name} · ${song.singer}`, after: '' })
    for (const [key, song] of newSongs) if (!oldSongs.has(key)) add({ kind: 'added', scope: next.name, before: '', after: `${song.name} · ${song.singer}` })
  }
  for (const [id, list] of right) if (!left.has(id)) add({ kind: 'added', scope: SYNC_DIFF_PLAYLIST_SCOPE, scopeKind: 'playlist', before: '', after: list.name })
  return result
}
