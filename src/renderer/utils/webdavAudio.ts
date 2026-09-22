export interface AudioEntry { path: string, name: string, directory: boolean, size: number }
export interface AudioDirectory { xml: string, url: string, root: string, identity: string }
export const parseAudioDirectory = (data: AudioDirectory): AudioEntry[] => {
  if (/<!DOCTYPE|<!ENTITY/i.test(data.xml)) throw new Error('WEBDAV_DIRECTORY_INVALID: 目录响应不允许实体声明')
  const doc = new DOMParser().parseFromString(data.xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('WEBDAV_DIRECTORY_INVALID: 目录响应格式错误')
  const root = new URL(data.root)
  const current = new URL(data.url)
  const entries = new Map<string, AudioEntry>()
  const text = (node: Element, name: string) => node.getElementsByTagNameNS('*', name)[0]?.textContent ?? ''
  const responses = doc.getElementsByTagNameNS('*', 'response')
  if (responses.length > 5001) throw new Error('WEBDAV_DIRECTORY_LIMIT: 单个目录最多显示 5000 项，请使用子目录')
  for (const response of Array.from(responses)) {
    const statuses = Array.from(response.getElementsByTagNameNS('*', 'status'))
    if (statuses.length && !statuses.some(status => /HTTP\/\S+\s+2\d\d\b/.test(status.textContent ?? ''))) continue
    let url: URL
    try { url = new URL(text(response, 'href'), data.url) } catch { continue }
    if (url.origin !== root.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(current.pathname) || url.pathname === current.pathname) continue
    const suffix = url.pathname.slice(current.pathname.length).replace(/\/$/, '')
    if (!suffix || suffix.includes('/')) continue
    let name: string
    try { name = decodeURIComponent(suffix) } catch { continue }
    if (/[\\/]/.test(name) || name === '.' || name === '..') continue
    const directory = response.getElementsByTagNameNS('*', 'collection').length > 0
    if (!directory && !/\.(mp3|flac|wav|m4a|ogg|opus|aac|webm)$/i.test(name)) continue
    const size = Number(text(response, 'getcontentlength'))
    entries.set(url.pathname, { path: url.pathname.slice(root.pathname.length), name: text(response, 'displayname') || name, directory, size: Number.isFinite(size) && size > 0 ? size : 0 })
  }
  return [...entries.values()].sort((left, right) => Number(right.directory) - Number(left.directory) || left.name.localeCompare(right.name))
}
export const audioSong = (entry: AudioEntry, identity: string): LX.Music.MusicInfoLocal => ({
  id: `webdav_${identity}_${entry.path}`,
  source: 'local',
  name: entry.name.replace(/\.[^.]+$/, ''),
  singer: 'WebDAV',
  interval: null,
  meta: { songId: entry.path, albumName: '', filePath: `webdav:${identity}/${entry.path}`, ext: entry.path.split('.').pop()!.toLowerCase(), webdav: { path: entry.path, identity } },
})
