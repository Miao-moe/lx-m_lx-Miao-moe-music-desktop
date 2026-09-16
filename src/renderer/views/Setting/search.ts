export const normalizeSearchText = (text: unknown) => String(text ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
export const searchTerms = (query: string) => [...new Set(normalizeSearchText(query).split(' ').filter(Boolean))]
export const matchesSearchText = (text: string, terms: string[]) => {
  const normalized = normalizeSearchText(text)
  return terms.every(term => normalized.includes(term))
}
export const matchesSearchKey = (key: string, prefix: string) => key == prefix || key.startsWith(`${prefix}_`)

interface SearchEntry { key: string, text: string }
interface SearchGroup {
  id: string
  title: string
  prefixes: string[]
  keys?: string[]
  excludes?: string[]
  searchText?: string
  entries?: SearchEntry[]
}
interface IndexedGroup { id: string, title: string, entries: SearchEntry[] }

const aliases: Record<string, string> = {
  setting__basic_theme: '深色模式 夜间模式 浅色模式',
  setting__basic_source: '音源',
  setting__play_playQuality: '播放音质 音质优先级',
  setting__advanced_ui_anim_speed: '动画速度',
  setting__download_path: '下载目录 保存位置',
}

// Index translations once per locale/catalog change, rather than scanning every
// setting and every language on each keystroke. Never index user-entered values.
export const createSearchIndex = (groups: SearchGroup[], messages: Record<string, string[]>): IndexedGroup[] => {
  const entries = Object.entries(messages)
  return groups.map(group => ({
    id: group.id,
    title: normalizeSearchText([group.title, ...(messages[group.prefixes[0]] ?? [])].join(' ')),
    entries: [
      ...entries.filter(([key]) => (group.prefixes.some(prefix => matchesSearchKey(key, prefix)) || group.keys?.includes(key)) && !group.excludes?.some(prefix => matchesSearchKey(key, prefix)))
        .map(([key, values]) => ({ key, text: normalizeSearchText([...values, aliases[key] ?? ''].join(' ')) })),
      ...(group.entries ?? []).map(entry => ({ ...entry, text: normalizeSearchText(entry.text) })),
      ...(group.searchText ? [{ key: group.id, text: normalizeSearchText(group.searchText) }] : []),
    ],
  }))
}

export const matchSearchIndex = (index: IndexedGroup[], query: string) => {
  const terms = searchTerms(query)
  const matches = new Map<string, { full: boolean, keys: string[] }>()
  if (!terms.length) return matches
  for (const group of index) {
    const full = matchesSearchText(group.title, terms)
    const keys = [...new Set(group.entries.filter(entry => matchesSearchText(`${group.title} ${entry.text}`, terms)).map(entry => entry.key))]
    if (full || keys.length) matches.set(group.id, { full, keys })
  }
  return matches
}
