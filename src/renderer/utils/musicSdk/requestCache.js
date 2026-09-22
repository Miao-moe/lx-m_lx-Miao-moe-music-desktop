import { getRequestSignal, shareRequest, throwIfRequestCancelled, withRequestScope } from '../requestContext'

// Cache only fulfilled values. Refresh replaces an older pending generation;
// its late result must not overwrite the refreshed value.
export const createRequestCache = (ttl = 30000, capacity = 100) => {
  const values = new Map()
  const pending = new Map()
  const generations = new Map()
  const request = (key, load, refresh = false) => {
    throwIfRequestCancelled()
    const cached = values.get(key)
    if (!refresh && cached && cached.expires > Date.now()) {
      values.delete(key)
      values.set(key, cached)
      return Promise.resolve(cached.value)
    }
    values.delete(key)
    if (refresh) pending.delete(key)
    if (!pending.has(key) || pending.get(key).controller.signal.aborted) generations.set(key, {})
    const generation = generations.get(key)
    return shareRequest(pending, key, async() => {
      const value = await load()
      throwIfRequestCancelled()
      if (generations.get(key) === generation && value != null) {
        values.set(key, { value, expires: Date.now() + ttl })
        while (values.size > capacity) values.delete(values.keys().next().value)
      }
      return value
    }).finally(() => {
      if ((!pending.has(key) || pending.get(key).controller.signal.aborted) && generations.get(key) === generation) generations.delete(key)
    })
  }
  request.clear = () => { values.clear(); pending.clear(); generations.clear() }
  return request
}

export const createRequestLimiter = (limit = 4) => {
  const queue = []
  let active = 0
  const runNext = () => {
    while (active < limit && queue.length) {
      const { task, resolve, reject, signal, abort } = queue.shift()
      signal?.removeEventListener('abort', abort)
      active++
      withRequestScope(signal, task).then(resolve, reject).finally(() => { active--; runNext() })
    }
  }
  return task => new Promise((resolve, reject) => {
    const signal = getRequestSignal()
    throwIfRequestCancelled(signal)
    const abort = () => {
      const index = queue.indexOf(job)
      if (index < 0) return
      queue.splice(index, 1)
      try { throwIfRequestCancelled(signal) } catch (error) { reject(error) }
    }
    const job = { task, resolve, reject, signal, abort }
    signal?.addEventListener('abort', abort, { once: true })
    queue.push(job)
    runNext()
  })
}

export const scheduleDetailRequest = createRequestLimiter(4)
