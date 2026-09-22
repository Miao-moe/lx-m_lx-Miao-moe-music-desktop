import { requestMsg } from '../message'
import { requestDelay, throwIfRequestCancelled } from '../requestContext'

const temporaryCodes = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'])
export const providerError = (source, code, statusCode = 200) => {
  const error = new Error(`${source} 请求失败 (HTTP ${statusCode}, code ${code ?? '?'})`)
  error.source = source
  error.code = code
  error.statusCode = statusCode
  const status = statusCode === 200 ? Number(code) : statusCode
  error.kind = status === 429 ? 'rate-limit' : [301, 401, 403].includes(status) ? 'permission' : status === 404 ? 'not-found' : status >= 500 && status < 600 ? 'server' : 'business'
  error.retryable = error.kind === 'server' || statusCode === 408
  error.stopSearchFallback = error.kind === 'rate-limit' || error.kind === 'permission'
  return error
}

export const isRetryableRequestError = error => error?.message !== requestMsg.cancelRequest && error?.name !== 'AbortError' && (
  error?.retryable === true || (error?.retryable == null && temporaryCodes.has(error?.code))
)

export const retryProviderRequest = async(task, attempts = 3) => {
  for (let attempt = 0; ; attempt++) {
    throwIfRequestCancelled()
    try { return await task() } catch (error) {
      if (attempt + 1 >= attempts || !isRetryableRequestError(error)) throw error
      await requestDelay(200 * 2 ** attempt)
    }
  }
}
