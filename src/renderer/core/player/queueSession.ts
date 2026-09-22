const validItem = (item: any): item is LX.Player.PlayMusicInfo => {
  if (!item || (item.listId !== null && typeof item.listId !== 'string') || typeof item.isTempPlay !== 'boolean') return false
  const music = item.musicInfo
  if (!music || typeof music.id !== 'string') return false
  const song = 'progress' in music ? music.metadata?.musicInfo : music
  return !!song && typeof song.name === 'string' && typeof song.singer === 'string' && typeof song.source === 'string' && !!song.meta && typeof song.meta === 'object'
}

export const readSavedQueue = (info: LX.Player.SavedPlayInfo | null) => {
  const queue = info?.queue
  if (!queue || queue.version !== 1 || !Array.isArray(queue.items) || !queue.items.every(validItem) ||
    (queue.current !== null && !validItem(queue.current)) || !Number.isInteger(queue.index) ||
    (queue.sourceListId !== null && typeof queue.sourceListId !== 'string') ||
    !Array.isArray(queue.played) || !queue.played.every(validItem)) return null
  return { ...queue, index: Math.max(-1, Math.min(queue.index, queue.items.length - 1)) }
}

export const createSavedPlayInfo = (
  items: LX.Player.PlayMusicInfo[], current: LX.Player.PlayMusicInfo | null,
  index: number, sourceListId: string | null, played: LX.Player.PlayMusicInfo[],
  time: number, maxTime: number, listIndex: number,
): LX.Player.SavedPlayInfo => ({
  time: Number.isFinite(time) ? Math.max(0, time) : 0,
  maxTime: Number.isFinite(maxTime) ? Math.max(0, maxTime) : 0,
  listId: current?.listId ?? '',
  index: listIndex,
  queue: { version: 1, items, current, index, sourceListId, played },
})
