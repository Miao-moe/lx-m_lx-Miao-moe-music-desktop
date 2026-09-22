import { createHook, executionAsyncResource } from 'node:async_hooks'
const requestMsg = { cancelRequest: '取消http请求', timeout: '请求超时' }

// Use the resource-based propagation supported by both Electron runtimes.
// Node 24's AsyncLocalStorage continuation frame crashes this renderer when
// Chromium delivers a UI callback after network work (pagination regression).
const scopeKey = Symbol('music-request-signal')
export const getRequestSignal = () => executionAsyncResource()[scopeKey]
createHook({
  init(_id, _type, _trigger, resource) {
    const signal = getRequestSignal()
    if (signal) resource[scopeKey] = signal
  },
}).enable()
const runInScope = (signal, run) => {
  const resource = executionAsyncResource()
  const previous = resource[scopeKey]
  resource[scopeKey] = signal
  try { return run() } finally { resource[scopeKey] = previous }
}
export const cancellationError = () => Object.assign(new Error(requestMsg.cancelRequest), { name: 'AbortError', code: 'ABORT_ERR' })
export const throwIfRequestCancelled = (signal = getRequestSignal()) => {
  if (signal?.aborted) throw signal.reason?.message ? signal.reason : cancellationError()
}

export const requestDelay = ms => new Promise((resolve, reject) => {
  const signal = getRequestSignal()
  throwIfRequestCancelled(signal)
  const abort = () => { clearTimeout(timer); reject(signal.reason?.message ? signal.reason : cancellationError()) }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', abort)
    resolve()
  }, ms)
  signal?.addEventListener('abort', abort, { once: true })
})

export const awaitRequest = (request, signal = getRequestSignal()) => {
  const promise = request?.promise ?? request
  if (!signal) return Promise.resolve(promise)
  return new Promise((resolve, reject) => {
    const abort = () => {
      try {
        if (request?.cancelHttp) request.cancelHttp()
        else request?.canceleFn?.()
      } catch {}
      reject(signal.reason?.message ? signal.reason : cancellationError())
    }
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export const withRequestScope = async(signal, run) => runInScope(signal ?? getRequestSignal(), () => {
  throwIfRequestCancelled()
  return awaitRequest(Promise.resolve().then(() => { throwIfRequestCancelled(); return run() }))
})

export const withRequestDeadline = async(timeout, run, signal = getRequestSignal()) => {
  throwIfRequestCancelled(signal)
  const controller = new AbortController()
  const abort = () => controller.abort(signal.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(Object.assign(new Error(requestMsg.timeout), {
    code: 'ETIMEDOUT', retryable: false, stopSearchFallback: true,
  })), timeout)
  try {
    return await withRequestScope(controller.signal, run)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

// Consumers own leases. Only the last cancellation stops a shared request.
export const shareRequest = (pending, key, run, signal = getRequestSignal()) => {
  throwIfRequestCancelled(signal)
  let entry = pending.get(key)
  if (!entry || entry.controller.signal.aborted) {
    const controller = new AbortController()
    entry = { controller, users: 0, done: false }
    const current = entry
    current.promise = withRequestScope(controller.signal, run).finally(() => {
      current.done = true
      if (pending.get(key) === current) pending.delete(key)
    })
    pending.set(key, current)
  }
  const current = entry
  current.users++
  const release = () => {
    if (--current.users === 0 && !current.done) current.controller.abort(cancellationError())
  }
  return awaitRequest(current.promise, signal).finally(release)
}
