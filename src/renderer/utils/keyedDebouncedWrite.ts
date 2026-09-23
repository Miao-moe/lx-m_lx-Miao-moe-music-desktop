interface Pending {
  write: () => Promise<void>
  resolve: (applied: boolean) => void
  reject: (error: unknown) => void
}

interface Entry {
  timer: ReturnType<typeof setTimeout> | null
  pending: Pending | null
  running: Promise<void>
}

// Keep the latest pending change for each song, while serializing writes already in flight.
export const createKeyedDebouncedWrite = (delay = 100) => {
  const entries = new Map<string, Entry>()
  return async(key: string, write: () => Promise<void>): Promise<boolean> => {
    let entry = entries.get(key)
    if (!entry) {
      entry = { timer: null, pending: null, running: Promise.resolve() }
      entries.set(key, entry)
    }
    if (entry.timer) clearTimeout(entry.timer)
    entry.pending?.resolve(false)
    return new Promise<boolean>((resolve, reject) => {
      entry.pending = { write, resolve, reject }
      entry.timer = setTimeout(() => {
        entry.timer = null
        const pending = entry.pending!
        entry.pending = null
        const task = entry.running.then(pending.write)
        entry.running = task.catch(() => {})
        void task.then(() => { pending.resolve(true) }, pending.reject)
        void entry.running.then(() => {
          if (!entry.pending && !entry.timer && entries.get(key) === entry) entries.delete(key)
        })
      }, delay)
    })
  }
}
