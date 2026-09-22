export interface PlatformSelection { mode: 'all' | 'include' | 'exclude', ids: string[] }
// Settings are flat primitives; structured preferences use a validated JSON string.
export const readPlatformSelection = (text: string): Record<string, PlatformSelection> => {
  const result: Record<string, PlatformSelection> = {}
  try {
    const value = JSON.parse(text)
    for (const source of ['wy', 'tx', 'kw', 'kg', 'mg']) {
      const item = value?.[source]
      if (!item || !['all', 'include', 'exclude'].includes(item.mode) || !Array.isArray(item.ids)) continue
      result[source] = { mode: item.mode, ids: [...new Set<string>(item.ids.filter((id: unknown) => typeof id === 'string' && id.length <= 1024).slice(0, 5000))] }
    }
  } catch { /* Old or malformed preferences fall back to all playlists. */ }
  return result
}
