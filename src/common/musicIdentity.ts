interface Song { id: string, name: string, singer: string, interval?: string | null, meta: { albumName?: string } }
export const normalizeMusicText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
export const musicSeconds = (text?: string | null) => text && /^\d+(?::\d{1,2}){1,2}$/.test(text) ? text.split(':').reduce((value, part) => value * 60 + Number(part), 0) : 0
export const musicIdentity = (song: Song) => JSON.stringify([
  normalizeMusicText(song.name),
  song.singer.split(/[、,&，;；/|]/).map(normalizeMusicText).filter(Boolean).sort(),
  normalizeMusicText(song.meta.albumName ?? ''),
])

// Preserve version markers in titles. Missing artist/duration is insufficient
// evidence to merge two different recordings, even when their names match.
export const findDuplicateSongs = <T extends Song>(songs: T[]) => {
  interface Item { id: string, index: number, musicInfo: T }
  const buckets = new Map<string, { items: Item[], min: number, max: number }>()
  const groups: Item[][] = []
  songs.forEach((song, index) => {
    const seconds = musicSeconds(song.interval)
    const base = song.singer.trim() && seconds ? musicIdentity(song) : JSON.stringify(['id', song.id])
    const bucket = Math.floor(seconds / 3)
    let group
    for (const offset of [-1, 0, 1]) {
      const candidate = buckets.get(`${base}:${bucket + offset}`)
      if (candidate && Math.max(candidate.max, seconds) - Math.min(candidate.min, seconds) <= 2) { group = candidate; break }
    }
    const item = { id: song.id, index, musicInfo: song }
    if (group) { group.items.push(item); group.min = Math.min(group.min, seconds); group.max = Math.max(group.max, seconds) } else { group = { items: [item], min: seconds, max: seconds }; groups.push(group.items); buckets.set(`${base}:${bucket}`, group) }
  })
  return groups.filter(group => group.length > 1).flat()
}
