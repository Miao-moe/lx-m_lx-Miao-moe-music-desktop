import { requestMsg } from '../message'
import { shareRequest, throwIfRequestCancelled, withRequestDeadline } from '../requestContext'

export const assertSearch = (condition) => {
  if (!condition) throw new Error('Invalid search response')
}

export const readSearchBody = (response) => {
  const status = Number(response?.statusCode)
  if (!(status >= 200 && status < 300)) {
    const error = new Error(`Search HTTP ${Number.isFinite(status) ? status : '?'}`)
    error.statusCode = status
    error.code = `HTTP_${status}`
    error.retryable = status >= 500 || status === 408
    // Do not bypass a server's explicit backoff by immediately trying another route.
    error.stopSearchFallback = status == 429
    throw error
  }
  return response.body
}

export const searchResult = (source, list, total, page, limit, extra = {}) => {
  assertSearch((typeof total == 'number' || (typeof total == 'string' && /^\d+$/.test(total))) && Number.isSafeInteger(Number(total)) && Number(total) >= 0)
  assertSearch(Array.isArray(list) && (list.length > 0 || (page - 1) * limit >= Number(total)))
  assertSearch(list.every(song => song?.source === source && song.songmid != null && song.songmid !== '' && typeof song.name == 'string' && song.name.length))
  return { ...extra, source, list, total: Number(total), limit, allPage: Math.ceil(Number(total) / limit) }
}

export const isSearchStopped = error => error?.message == requestMsg.cancelRequest || error?.name === 'AbortError' || error?.searchDetails?.kind == 'cancelled' ||
  error?.stopSearchFallback || error?.retryAfterMs > 5000 || error?.searchDetails?.httpStatus == 429

// One chain per query/page. Keep the selected route while paging: providers can
// rank the same songs differently, so switching halfway would skip/repeat songs.
export const withSearchFallback = (primary, fallbacks) => {
  const routes = [primary, ...fallbacks]
  const pending = new Map()
  const sessions = new Map()
  const clone = result => JSON.parse(JSON.stringify(result))
  return function(str, page = 1, limit = this.limit, { refresh = false } = {}) {
    if (limit == null) limit = this.limit
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return Promise.reject(new Error('Invalid search pagination'))
    const queryKey = JSON.stringify([str, limit])
    const key = JSON.stringify([str, page, limit])
    let session = sessions.get(queryKey)
    const cached = session?.results.get(page)
    if (!refresh && cached && cached.expires > Date.now()) {
      this.total = cached.result.total
      this.page = page
      this.allPage = cached.result.allPage
      return Promise.resolve(clone(cached.result))
    }
    if (refresh) { pending.delete(key); session?.results.delete(page) }
    if (!session || (page == 1 && !pending.has(key))) {
      session = { route: null, results: new Map() }
      sessions.delete(queryKey)
      sessions.set(queryKey, session)
      if (sessions.size > 30) sessions.delete(sessions.keys().next().value)
    }
    return shareRequest(pending, key, async() => withRequestDeadline(20000, async() => {
      const generation = pending.get(key)
      const context = { attempts: 0, refresh }
      // A quick page change must wait for page one to choose a route.
      if (page > 1) await pending.get(JSON.stringify([str, 1, limit]))?.promise
      const start = session.route ?? 0
      const end = session.route == null ? routes.length : start + 1
      let failure
      for (let index = start; index < end; index++) {
        throwIfRequestCancelled()
        try {
          const result = await routes[index].call(this, str, page, limit, context)
          const checked = searchResult(result.source, result.list, result.total, page, limit, result)
          throwIfRequestCancelled()
          if (pending.get(key) === generation) {
            session.route = index
            this.total = checked.total
            this.page = page
            this.allPage = checked.allPage
            session.results.set(page, { result: clone(checked), expires: Date.now() + 30000 })
            while (session.results.size > 5) session.results.delete(session.results.keys().next().value)
          }
          return checked
        } catch (error) {
          if (isSearchStopped(error)) throw error
          failure = error
          // Route indices only; never log query text, signed URLs or response bodies.
          if (index + 1 < end) console.warn('[SearchFallback]', index, '->', index + 1)
        }
      }
      throw failure
    })).then(clone)
  }
}
