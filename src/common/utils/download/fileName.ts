// Windows filenames exclude control characters as well as path separators.
// eslint-disable-next-line no-control-regex
const clean = (value: string) => value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[ .]+$/g, '').trim()
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
export const formatDownloadFileName = (template: string, song: { id?: string, name?: string, singer?: string, source?: string, meta?: { albumName?: string } }, quality: string, ext: string) => {
  const fields: Record<string, string> = { title: song.name?.trim() ? song.name : 'Unknown', artist: song.singer?.trim() ? song.singer : 'Unknown', album: song.meta?.albumName?.trim() ? song.meta.albumName : 'Unknown', source: song.source ?? '', quality, id: song.id ?? '' }
  let name = template.replace(/\{(title|artist|album|source|quality|id)\}|歌名|歌手/g, (match, field: string) => fields[field || (match === '歌名' ? 'title' : 'artist')])
  name = clean(name).slice(0, 180).replace(/[ .]+$/g, '') || 'Unknown'
  if (reserved.test(name)) name = '_' + name
  return name + '.' + ext.replace(/[^a-z0-9]/gi, '')
}
