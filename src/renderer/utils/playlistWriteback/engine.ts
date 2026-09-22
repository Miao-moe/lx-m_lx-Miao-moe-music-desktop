import { describeChanges, mergeOrder, planChanges, recoverAppliedChanges, sameKeys, snapshotEqual } from './plan'
import { errorForTransport } from '@common/utils/errorMessage'
import { WritebackError, type Binding, type LocalPlaylist, type RemoteSession, type SavedState, type Status } from './types'

interface Dependencies {
  load: () => Promise<SavedState | null>
  save: (state: SavedState) => Promise<void>
  local: (id: string) => Promise<LocalPlaylist | null>
  open: (playlist: LocalPlaylist) => Promise<RemoteSession>
  status: (id: string, status: Status) => void
  lockLocal: <T>(id: string, task: () => Promise<T>) => Promise<T>
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export const createWritebackEngine = (deps: Dependencies) => {
  const bindings: Record<string, Binding> = Object.create(null)
  const tasks = new Map<string, Promise<unknown>>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const refreshing = new Set<string>()
  const differences = new Map<string, Status['diff']>()
  let initialization: Promise<void> | undefined
  let saves: Promise<void> | undefined
  let requestedSave = 0
  let persistedSave = 0
  let disposed = false

  const report = (id: string, state: Status['state'], error?: Status['error'], cause?: unknown) => {
    const binding = bindings[id]
    deps.status(id, {
      enabled: Boolean(binding?.enabled),
      state,
      error,
      ignored: binding?.local.ignored,
      lastSuccess: binding?.lastSuccess,
      capabilities: binding?.capabilities,
      diagnostic: cause ? errorForTransport(cause).message : undefined,
      diff: error === 'conflict' ? differences.get(id) : undefined,
    })
    if (error !== 'conflict') differences.delete(id)
  }
  const save = async() => {
    const requested = ++requestedSave
    while (persistedSave < requested) {
      saves ??= Promise.resolve().then(async() => {
        while (persistedSave !== requestedSave) {
          const version = requestedSave
          await deps.save(copy({ version: 1, lists: bindings }))
          // eslint-disable-next-line require-atomic-updates -- This single save loop owns the persisted version.
          persistedSave = version
        }
      }).finally(() => { saves = undefined })
      try { await saves } catch (cause) { throw new WritebackError('storage', cause) }
      // A request arriving between the loop's exit and its finally must start
      // another save before its caller is allowed to issue remote mutations.
    }
  }
  const init = async() => {
    initialization ??= (async() => {
      const saved = await deps.load()
      if (!saved) return
      if (saved.version !== 1 || !saved.lists || typeof saved.lists !== 'object') throw new WritebackError('storage')
      for (const [id, binding] of Object.entries(saved.lists)) {
        if (!binding?.local?.tracks || !binding.remote?.tracks || !binding.ownerId || !binding.capabilities) continue
        bindings[id] = binding
        report(id, binding.enabled ? 'pending' : 'idle')
      }
    })().catch(error => { initialization = undefined; throw error })
    await initialization
  }
  const serialize = async<T>(id: string, task: () => Promise<T>): Promise<T> => {
    const previous = tasks.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    tasks.set(id, next)
    try { return await next } finally { if (tasks.get(id) === next) tasks.delete(id) }
  }
  const getLocal = async(id: string, binding: Binding) => {
    const local = await deps.local(id)
    if (!local || local.source !== binding.source || local.remoteId !== binding.remoteId) throw new WritebackError('owner')
    return local
  }
  const assertEnabled = (id: string, binding: Binding, session: RemoteSession) => {
    if (disposed || bindings[id] !== binding || !binding.enabled) throw new WritebackError('pending')
    session.assertActive()
    if (session.ownerId !== binding.ownerId) throw new WritebackError('owner')
  }

  const sync = async(id: string) => {
    const binding = bindings[id]
    if (!binding?.enabled || disposed) return
    const local = await getLocal(id, binding)
    const desired = copy(local.snapshot)
    let changes = planChanges(binding.local, desired, binding.capabilities)
    if (!changes.changed && !binding.inFlight) {
      if (!snapshotEqual(binding.local, desired)) { binding.local = desired; await save() }
      report(id, binding.lastSuccess ? 'success' : 'idle')
      return
    }
    report(id, 'syncing')
    const session = await deps.open(local)
    session.setGuard?.(() => {
      if (disposed || bindings[id] !== binding || !binding.enabled) throw new WritebackError('pending')
    })
    assertEnabled(id, binding, session)
    const remote = await session.read()
    differences.set(id, { local: describeChanges(binding.local, desired), remote: describeChanges(binding.remote, remote) })
    if (binding.inFlight) {
      const previous = copy(binding)
      binding.local = recoverAppliedChanges(binding.local, binding.inFlight, remote, binding.capabilities)
      if (binding.local.name !== previous.local.name) binding.remote.name = remote.name
      if (planChanges(previous.local, binding.inFlight, binding.capabilities).order) {
        const attemptedKeys = new Set(binding.inFlight.tracks.map(track => track.key))
        const remoteKeys = new Set(remote.tracks.map(track => track.key))
        if (sameKeys(remote.tracks.map(track => track.key).filter(key => attemptedKeys.has(key)),
          binding.inFlight.tracks.map(track => track.key).filter(key => remoteKeys.has(key)))) binding.remote.tracks = remote.tracks
      }
      binding.inFlight = undefined
      try { await save() } catch (error) {
        Object.assign(binding, { local: previous.local, remote: previous.remote, inFlight: previous.inFlight })
        throw error
      }
      changes = planChanges(binding.local, desired, binding.capabilities)
      if (!changes.changed) { report(id, 'success'); return }
    }
    if (changes.rename && remote.name !== binding.remote.name && remote.name !== desired.name) throw new WritebackError('conflict')
    if (changes.order) {
      const desiredKeys = new Set(desired.tracks.map(track => track.key))
      const common = new Set(binding.remote.tracks.filter(track => desiredKeys.has(track.key)).map(track => track.key))
      const previousOrder = binding.remote.tracks.map(track => track.key).filter(key => common.has(key))
      const remoteOrder = remote.tracks.map(track => track.key).filter(key => common.has(key))
      const wantedOrder = desired.tracks.map(track => track.key).filter(key => common.has(key))
      // Remote deletions are allowed; two different reorders require user intervention.
      const present = new Set(remoteOrder)
      if (!sameKeys(remoteOrder, previousOrder.filter(key => present.has(key))) && !sameKeys(remoteOrder, wantedOrder.filter(key => present.has(key)))) throw new WritebackError('conflict')
    }
    const remoteMap = new Map(remote.tracks.map(track => [track.key, track]))
    const additions = changes.add.filter(track => !remoteMap.has(track.key))
    const removals = changes.remove.map(track => remoteMap.get(track.key)).filter((track): track is NonNullable<typeof track> => !!track)
    binding.inFlight = desired
    await save()
    // API implementations validate/resolve every identifier in a batch before sending it.
    if (additions.length) {
      assertEnabled(id, binding, session)
      await session.add(additions)
    }
    if (removals.length) {
      assertEnabled(id, binding, session)
      await session.remove(removals)
    }
    if (changes.rename && remote.name !== desired.name) {
      assertEnabled(id, binding, session)
      await session.rename(desired.name)
    }
    let verified = await session.read()
    let ordered: string[] | undefined
    if (changes.order) {
      ordered = mergeOrder(verified.tracks.map(track => track.key), desired.tracks.map(track => track.key))
      if (!sameKeys(ordered, verified.tracks.map(track => track.key))) {
        assertEnabled(id, binding, session)
        await session.order(ordered)
        verified = await session.read()
      }
    }
    const actual = new Set(verified.tracks.map(track => track.key))
    if (changes.add.some(track => !actual.has(track.key)) || changes.remove.some(track => actual.has(track.key)) ||
      (changes.rename && verified.name !== desired.name) || (ordered && !sameKeys(ordered, verified.tracks.map(track => track.key)))) throw new WritebackError('verify')
    assertEnabled(id, binding, session)
    const previous = { local: binding.local, remote: binding.remote, lastSuccess: binding.lastSuccess }
    binding.local = desired
    binding.remote = verified
    binding.lastSuccess = Date.now()
    binding.inFlight = undefined
    try { await save() } catch (error) {
      Object.assign(binding, previous, { inFlight: desired })
      throw error
    }
    report(id, 'success')
    const latest = await getLocal(id, binding)
    if (planChanges(binding.local, latest.snapshot, binding.capabilities).changed) schedule(id)
  }

  const run = async(id: string) => {
    await init()
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    await serialize(id, async() => {
      try { await sync(id) } catch (error) {
        report(id, 'failed', error instanceof WritebackError ? error.code : 'failed', error)
      }
    })
  }
  const schedule = (id: string) => {
    if (!bindings[id]?.enabled || refreshing.has(id) || disposed) return
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    report(id, 'pending')
    timers.set(id, setTimeout(() => { void run(id).catch(() => { report(id, 'failed', 'storage') }) }, 800))
  }
  const changed = async(ids: string[], reset = false) => {
    // A restore/removal broadcast must stop further writes before yielding to any pending request.
    if (reset) for (const id of ids) if (bindings[id]) bindings[id].enabled = false
    await init()
    let removed = false
    for (const id of ids) {
      if (reset || !(await deps.local(id))) {
        if (bindings[id]) { bindings[id].enabled = false; removed = true }
        report(id, 'idle')
      } else schedule(id)
    }
    if (removed) await save()
  }
  const setEnabled = async(id: string, enabled: boolean) => {
    await init()
    // Stop subsequent requests immediately, including during an in-flight batch.
    if (!enabled && bindings[id]) bindings[id].enabled = false
    await serialize(id, async() => {
      if (!enabled) {
        if (bindings[id]) bindings[id].enabled = false
        await save()
        report(id, 'idle')
        return
      }
      const local = await deps.local(id)
      if (!local) throw new WritebackError('unsupported')
      const session = await deps.open(local)
      const remote = await session.read()
      session.assertActive()
      const current = await deps.local(id)
      if (!current || current.source !== local.source || current.remoteId !== local.remoteId || !snapshotEqual(local.snapshot, current.snapshot)) throw new WritebackError('pending')
      bindings[id] = {
        enabled: true,
        source: local.source,
        remoteId: local.remoteId,
        ownerId: session.ownerId,
        capabilities: session.capabilities,
        local: copy(local.snapshot),
        remote,
      }
      try { await save() } catch (error) { bindings[id].enabled = false; throw error }
      report(id, 'idle')
    })
  }

  const refresh = async<T>(id: string, read: () => Promise<T>, apply: (data: T) => Promise<void>) => {
    await init()
    await serialize(id, async() => {
      const binding = bindings[id]
      const before = await deps.local(id)
      let session: RemoteSession | undefined
      if (binding?.enabled) {
        if (!before || before.source !== binding.source || before.remoteId !== binding.remoteId) throw new WritebackError('owner')
        if (binding.inFlight != null || planChanges(binding.local, before.snapshot, binding.capabilities).changed) {
          schedule(id)
          throw new WritebackError('pending')
        }
        session = await deps.open(before)
        assertEnabled(id, binding, session)
      }
      const data = await read()
      const remote = await session?.read()
      await deps.lockLocal(id, async() => {
        const current = await deps.local(id)
        if (before && (!current || current.source !== before.source || current.remoteId !== before.remoteId || !snapshotEqual(before.snapshot, current.snapshot))) throw new WritebackError('pending')
        if (session) assertEnabled(id, binding, session)
        refreshing.add(id)
        try {
          await apply(data)
          if (binding?.enabled) {
            const after = await getLocal(id, binding)
            if (!session || !remote) throw new WritebackError('pending')
            assertEnabled(id, binding, session)
            if (!snapshotEqual(binding.remote, remote) || !snapshotEqual(binding.local, after.snapshot)) {
              binding.remote = remote
              binding.local = copy(after.snapshot)
              await save()
            }
            report(id, 'idle')
          }
        } finally { refreshing.delete(id) }
      })
    })
  }
  const start = async() => {
    await init()
    for (const id of Object.keys(bindings)) schedule(id)
  }
  const dispose = () => {
    disposed = true
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    differences.clear()
  }
  return { init, start, changed, run, setEnabled, refresh, dispose }
}
