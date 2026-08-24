const DEFAULT_CACHE_TTL = 30 * 60 * 1000
const EXPIRE_SAFETY_TIME = 2 * 60 * 1000
const MIN_TIMESTAMP = Date.UTC(2000, 0, 1)
const MAX_TIMESTAMP = Date.UTC(2100, 0, 1)

const isValidTimestamp = (timestamp: number) => {
  return Number.isFinite(timestamp) && timestamp >= MIN_TIMESTAMP && timestamp <= MAX_TIMESTAMP
}

const parseTimestamp = (value: string): number | null => {
  if (/^\d{10,13}$/.test(value)) {
    const timestamp = Number(value)
    const normalizedTimestamp = value.length <= 10 ? timestamp * 1000 : timestamp
    return isValidTimestamp(normalizedTimestamp) ? normalizedTimestamp : null
  }

  const timestamp = Date.parse(value)
  return isValidTimestamp(timestamp) ? timestamp : null
}

const parseSignedDate = (value: string): number | null => {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value)
  if (!match) return parseTimestamp(value)

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
  return isValidTimestamp(timestamp) ? timestamp : null
}

const getUrlExpireTime = (url: string): number | null => {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }

  const params = new Map<string, string>()
  parsedUrl.searchParams.forEach((value, key) => {
    params.set(key.toLowerCase(), value)
  })

  const expireTimes: number[] = []
  for (const key of ['expires', 'expire', 'expiration', 'expiry', 'deadline', 'validuntil', 'valid_until', 'e', 'se']) {
    const value = params.get(key)
    if (!value) continue
    const expireTime = parseTimestamp(value)
    if (expireTime != null) expireTimes.push(expireTime)
  }

  const wsTime = params.get('wstime')
  if (wsTime && /^[\da-f]{8,}$/i.test(wsTime)) {
    const expireTime = Number.parseInt(wsTime, 16) * 1000
    if (isValidTimestamp(expireTime)) expireTimes.push(expireTime)
  }

  const authKeyTime = params.get('auth_key')?.split('-')[0]
  if (authKeyTime) {
    const expireTime = parseTimestamp(authKeyTime)
    if (expireTime != null) expireTimes.push(expireTime)
  }

  for (const [dateKey, durationKey] of [
    ['x-amz-date', 'x-amz-expires'],
    ['x-goog-date', 'x-goog-expires'],
    ['x-oss-date', 'x-oss-expires'],
  ]) {
    const date = params.get(dateKey)
    const duration = Number(params.get(durationKey))
    if (!date || !Number.isFinite(duration) || duration <= 0) continue
    const startTime = parseSignedDate(date)
    if (startTime != null) expireTimes.push(startTime + duration * 1000)
  }

  return expireTimes.length ? Math.min(...expireTimes) : null
}

export const getMusicUrlCacheExpireTime = (url: string, now = Date.now()) => {
  const defaultExpireTime = now + DEFAULT_CACHE_TTL
  const urlExpireTime = getUrlExpireTime(url)
  if (urlExpireTime == null) return defaultExpireTime
  return Math.max(now, Math.min(defaultExpireTime, urlExpireTime - EXPIRE_SAFETY_TIME))
}
