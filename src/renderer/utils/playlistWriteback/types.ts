import type { SyncDiff } from '@common/syncDiff'

export type WritebackSource = 'wy' | 'tx' | 'kg' | 'mg'

export interface Track {
  key: string
  name?: string
  songId?: string
  songType?: number
  hash?: string
  fileId?: string
  albumId?: string
  contentId?: string
  copyrightId?: string
}

export interface Snapshot {
  name: string
  tracks: Track[]
  ignored?: number
  // Includes local-only entries so a refresh cannot race with edits to those entries.
  fingerprint?: string
}

export interface LocalPlaylist {
  source: WritebackSource
  remoteId: string
  snapshot: Snapshot
}

export interface Capabilities { rename: boolean, order: boolean }

export interface RemoteSession {
  ownerId: string
  capabilities: Capabilities
  read: () => Promise<Snapshot>
  add: (tracks: Track[]) => Promise<void>
  remove: (tracks: Track[]) => Promise<void>
  rename: (name: string) => Promise<void>
  order: (keys: string[]) => Promise<void>
  assertActive: () => void
  setGuard?: (guard: () => void) => void
}

export type ErrorCode = 'login' | 'owner' | 'unsupported' | 'incomplete' | 'identity' | 'conflict' | 'verify' | 'pending' | 'storage' | 'failed'

export class WritebackError extends Error {
  constructor(public readonly code: ErrorCode, cause?: unknown) {
    super(code, { cause })
  }
}

export interface Binding {
  enabled: boolean
  source: WritebackSource
  remoteId: string
  ownerId: string
  capabilities: Capabilities
  local: Snapshot
  remote: Snapshot
  // Written before the first request; recovered by reading the platform after a crash/timeout.
  inFlight?: Snapshot
  lastSuccess?: number
}

export interface SavedState { version: 1, lists: Record<string, Binding> }
export interface Status {
  enabled: boolean
  state: 'idle' | 'pending' | 'syncing' | 'success' | 'failed'
  error?: ErrorCode
  ignored?: number
  lastSuccess?: number
  capabilities?: Capabilities
  diagnostic?: string
  diff?: { local: SyncDiff, remote: SyncDiff }
}
