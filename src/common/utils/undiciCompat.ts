import * as undici from 'undici'
import type { Dispatcher } from 'undici'
import { setTimeout as delay } from 'node:timers/promises'

type Interceptor = (dispatch: Dispatcher['dispatch']) => Dispatcher['dispatch']
type ComposableDispatcher = Dispatcher & { compose?: (...interceptors: Interceptor[]) => Dispatcher }
const interceptors = Reflect.get(undici, 'interceptors') as undefined | {
  redirect: (options: { maxRedirections: number }) => Interceptor
  retry: (options: { maxRetries: number, minTimeout: number, maxTimeout: number, timeoutFactor: number, retryAfter: boolean }) => Interceptor
}

export const composeDispatcher = (base: Dispatcher, maxRedirect: number, retryNum = 0): Dispatcher => {
  const dispatcher = base as ComposableDispatcher
  if (!interceptors || !dispatcher.compose) return base
  const chain: Interceptor[] = []
  if (maxRedirect) chain.push(interceptors.redirect({ maxRedirections: maxRedirect }))
  if (retryNum) chain.push(interceptors.retry({ maxRetries: retryNum, minTimeout: 1000, maxTimeout: 10000, timeoutFactor: 2, retryAfter: true }))
  return chain.length ? dispatcher.compose(...chain) : base
}

type RequestOptions = NonNullable<Parameters<typeof undici.request>[1]>
const retryMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'])
const retryStatuses = new Set([429, 500, 502, 503, 504])
const retryErrors = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ENETDOWN', 'ENETUNREACH', 'EHOSTDOWN', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_SOCKET'])

// Undici 5 follows redirects through request options. Undici 7 uses composed
// dispatchers. Keep proxying, cancellation and retry semantics on both runtimes.
export const requestWithCompatibility = async(url: string, options: RequestOptions, maxRedirect = 5, retryNum = 0): ReturnType<typeof undici.request> => {
  const legacyOptions: RequestOptions & { maxRedirections?: number } = { ...options }
  if (!interceptors) legacyOptions.maxRedirections = maxRedirect
  const retries = !interceptors && retryMethods.has(options.method ?? 'GET') ? Math.max(0, retryNum) : 0
  const signal = options.signal as AbortSignal | undefined
  for (let attempt = 0; ; attempt++) {
    let retryAfter = 0
    try {
      const response = await undici.request(url, legacyOptions)
      if (attempt >= retries || !retryStatuses.has(response.statusCode)) return response
      const header = response.headers['retry-after']
      if (typeof header === 'string') retryAfter = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()
      await response.body.dump()
    } catch (error: any) {
      if (attempt >= retries || signal?.aborted === true || !retryErrors.has(error?.code)) throw error
    }
    await delay(Math.min(10000, Math.max(1000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter : 0)), undefined, { signal })
  }
}
