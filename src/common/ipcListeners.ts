type Listener = (...args: any[]) => any
interface Emitter {
  on: (name: string, listener: Listener) => unknown
  removeListener: (name: string, listener: Listener) => unknown
  removeAllListeners: (name: string) => unknown
}

// Keep the actual IPC callback so cancellation also removes its argument adapter.
export const createIpcListeners = (emitter: Emitter, authorize?: (event: any, name: string, params: unknown) => boolean) => {
  const channels = new Map<string, Set<{ listener: Listener, wrapped: Listener, active: boolean }>>()
  const on = (name: string, listener: Listener, once = false) => {
    let entries = channels.get(name)
    if (!entries) channels.set(name, entries = new Set())
    const entry = { listener, wrapped: (() => {}) as Listener, active: true }
    const remove = () => {
      entry.active = false
      emitter.removeListener(name, entry.wrapped)
      entries.delete(entry)
      if (!entries.size) channels.delete(name)
    }
    entry.wrapped = (event, params) => {
      // EventEmitter snapshots its callbacks during emit; off must still win.
      if (!entry.active) return
      if (authorize && !authorize(event, name, params)) return
      if (once) remove()
      listener({ event, params })
    }
    entries.add(entry)
    emitter.on(name, entry.wrapped)
  }
  const off = (name: string, listener: Listener) => {
    const entries = channels.get(name)
    if (!entries) return
    for (const entry of entries) {
      if (entry.listener !== listener) continue
      entry.active = false
      emitter.removeListener(name, entry.wrapped)
      entries.delete(entry)
    }
    if (!entries.size) channels.delete(name)
  }
  const offAll = (name: string) => {
    for (const entry of channels.get(name) ?? []) entry.active = false
    channels.delete(name)
    emitter.removeAllListeners(name)
  }
  return { on, off, offAll }
}
