import type { Capabilities, Snapshot, Track } from './types'
import type { SyncDiff } from '@common/syncDiff'

export const describeChanges = (before: Snapshot, after: Snapshot): SyncDiff => {
  const plan = planChanges(before, after, { rename: true, order: true })
  const changes: SyncDiff['changes'] = []
  if (plan.rename) changes.push({ kind: 'renamed', scope: '歌单', before: before.name, after: after.name })
  for (const track of plan.add.slice(0, 100)) changes.push({ kind: 'added', scope: after.name, before: '', after: track.name ?? track.key })
  for (const track of plan.remove.slice(0, Math.max(0, 100 - changes.length))) changes.push({ kind: 'removed', scope: after.name, before: track.name ?? track.key, after: '' })
  if (plan.order && !plan.add.length && !plan.remove.length) changes.push({ kind: 'changed', scope: after.name, before: '歌曲顺序', after: '顺序已改变' })
  return { changes: changes.slice(0, 100), total: plan.add.length + plan.remove.length + Number(plan.rename) + Number(plan.order && !plan.add.length && !plan.remove.length) }
}

const keys = (tracks: Track[]) => tracks.map(track => track.key)
export const sameKeys = (left: string[], right: string[]) => left.length === right.length && left.every((key, index) => key === right[index])

export const planChanges = (before: Snapshot, after: Snapshot, capabilities: Capabilities) => {
  const oldKeys = new Set(keys(before.tracks))
  const newKeys = new Set(keys(after.tracks))
  const add = after.tracks.filter(track => !oldKeys.has(track.key))
  const remove = before.tracks.filter(track => !newKeys.has(track.key))
  const rename = capabilities.rename && before.name !== after.name
  const order = capabilities.order && !sameKeys(keys(before.tracks), keys(after.tracks))
  return { add, remove, rename, order, changed: !!(add.length || remove.length || rename || order) }
}

// Keep remotely added songs in their slots; reorder only songs the user edited locally.
export const mergeOrder = (remote: string[], local: string[]) => {
  const remoteKeys = new Set(remote)
  const desired = local.filter(key => remoteKeys.has(key))
  const localKeys = new Set(desired)
  let index = 0
  return remote.map(key => localKeys.has(key) ? desired[index++] : key)
}

export const snapshotEqual = (left: Snapshot, right: Snapshot) => left.name === right.name && left.ignored === right.ignored && left.fingerprint === right.fingerprint &&
  left.tracks.length === right.tracks.length && left.tracks.every((track, index) => {
  const other = right.tracks[index]
  return track.key === other.key && track.name === other.name && track.songId === other.songId && track.songType === other.songType && track.hash === other.hash && track.fileId === other.fileId && track.albumId === other.albumId && track.contentId === other.contentId && track.copyrightId === other.copyrightId
})

export const recoverAppliedChanges = (before: Snapshot, attempted: Snapshot, remote: Snapshot, capabilities: Capabilities): Snapshot => {
  const changes = planChanges(before, attempted, capabilities)
  const actual = new Set(remote.tracks.map(track => track.key))
  const recovered = new Map(before.tracks.map(track => [track.key, track]))
  for (const track of changes.add) if (actual.has(track.key)) recovered.set(track.key, track)
  for (const track of changes.remove) if (!actual.has(track.key)) recovered.delete(track.key)
  let tracks = [...recovered.values()]
  if (changes.order) {
    const expected = attempted.tracks.map(track => track.key).filter(key => actual.has(key))
    const known = new Set(expected)
    const current = remote.tracks.map(track => track.key).filter(key => known.has(key))
    if (sameKeys(current, expected)) tracks = mergeOrder(tracks.map(track => track.key), expected).map(key => recovered.get(key)!)
  }
  return { ...before, tracks, name: changes.rename && remote.name === attempted.name ? attempted.name : before.name }
}
