export const normalizeTimeoutMinutes = (value: string | number, maximum = 1440): number | null => {
  const text = String(value).trim()
  if (!/^\d+$/.test(text)) return null
  const minutes = Number(text)
  if (!Number.isFinite(minutes) || minutes < 1) return null
  return Math.min(minutes, maximum)
}
