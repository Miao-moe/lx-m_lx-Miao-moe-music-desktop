declare namespace LX.List {
  interface TrashEntry {
    id: string
    kind: 'list' | 'songs'
    listId: string
    listName: string
    songName: string
    count: number
    deletedAt: number
    expiresAt: number
  }

  interface TrashRestoreResult {
    restoredIds: string[]
    createdLists: Array<{ position: number, listInfo: UserListInfo }>
    musicLists: Array<{ listId: string, musicInfos: LX.Music.MusicInfo[] }>
  }
}
