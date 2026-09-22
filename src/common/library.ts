export interface SmartRule { kind: 'recent' | 'unplayed' | 'downloaded', days: number, sourceList: string }
export interface ListOrganization { folder: string, tags: string[], pinned: boolean, smart?: SmartRule }
export interface LibraryFolder { path: string, listId: string, enabled: boolean }
export interface LibraryPreferences { lists: Record<string, ListOrganization>, folders: LibraryFolder[] }
export interface HistoryVersion { id: number, listId: string, time: number, reason: string, count: number }
export interface LibraryQuery { search?: string, singer?: string, album?: string, year?: string, missing?: boolean, page?: number }
export interface ListeningQuery { search?: string, from?: number, to?: number, page?: number }
export interface HistoryDiff { listId: string, songs: LX.Music.MusicInfo[], added: LX.Music.MusicInfo[], removed: LX.Music.MusicInfo[], changed: LX.Music.MusicInfo[], reordered: number }
export interface LibraryService {
  getLibraryPreferences: () => LibraryPreferences
  saveLibraryPreferences: (data: LibraryPreferences) => void
  captureListHistory: (id: string, reason?: string) => void
  getListHistory: (id: string) => HistoryVersion[]
  getListHistoryDiff: (id: number) => HistoryDiff
  recordListening: (song: LX.Music.MusicInfo) => void
  getListeningHistory: (query?: ListeningQuery) => { rows: Array<{ id: number, time: number, song: LX.Music.MusicInfo }>, stats: { plays: number, songs: number, singers: number }, artists: Array<{ singer: string, count: number }> }
  clearListeningHistory: () => void
  getLibraryCatalog: (query?: LibraryQuery) => { songs: Array<{ song: LX.Music.MusicInfo, missing: boolean }>, count: number }
  getLibraryFacets: () => Record<'singers' | 'albums' | 'years', Array<{ value: string, count: number }>>
  getLibraryLocalFiles: () => LX.Music.MusicInfoLocal[]
  setLibraryFileStatus: (items: Array<{ id: string, missing: boolean }>) => void
  getSmartPlaylist: (rule: SmartRule, excludeList?: string) => LX.Music.MusicInfo[]
  getDatabaseCacheSizes: () => { lyrics: number, urls: number, sources: number }
}
export const emptyLibraryPreferences = (): LibraryPreferences => ({ lists: {}, folders: [] })
export const validateLibraryPreferences = (data: LibraryPreferences): LibraryPreferences => {
  const invalid = () => { throw Object.assign(new Error('曲库设置格式不正确'), { code: 'LIBRARY_INVALID' }) }
  if (!data?.lists || typeof data.lists !== 'object' || Array.isArray(data.lists) || !Array.isArray(data.folders) || data.folders.length > 100 || Object.keys(data.lists).length > 5000) invalid()
  for (const [id, entry] of Object.entries(data.lists)) {
    if (['__proto__', 'constructor', 'prototype'].includes(id) || !entry || typeof entry.folder !== 'string' || entry.folder.length > 100 || typeof entry.pinned !== 'boolean' || !Array.isArray(entry.tags) || entry.tags.length > 20 || entry.tags.some(tag => typeof tag !== 'string' || tag.length > 80)) invalid()
    if (entry.smart && (!['recent', 'unplayed', 'downloaded'].includes(entry.smart.kind) || !Number.isInteger(entry.smart.days) || entry.smart.days < 1 || entry.smart.days > 36500 || typeof entry.smart.sourceList !== 'string')) invalid()
    if (entry.smart?.sourceList && (entry.smart.sourceList === id || data.lists[entry.smart.sourceList]?.smart)) invalid()
  }
  for (const folder of data.folders) if (!folder || typeof folder.path !== 'string' || !folder.path || folder.path.length > 8192 || typeof folder.listId !== 'string' || typeof folder.enabled !== 'boolean') invalid()
  return data
}
