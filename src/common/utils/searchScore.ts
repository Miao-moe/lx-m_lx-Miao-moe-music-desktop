import { similar } from './common'
import { BoundedMap } from './boundedMap'

const scores = new BoundedMap<string, { score: number, bytes: number }>(12000, 4 * 1024 * 1024, value => value.bytes)
export const searchScore = (query: string, text: string) => {
  const key = JSON.stringify([query, text])
  const cached = scores.get(key)
  if (cached) return cached.score
  const score = similar(query, text)
  scores.set(key, { score, bytes: key.length * 2 + 32 })
  return score
}
