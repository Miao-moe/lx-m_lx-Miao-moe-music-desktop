import needle from 'needle'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { cancellationError, throwIfRequestCancelled } from './requestContext'

export const createProxyAgentPool = () => {
  let proxyKey = ''
  const proxyAgents = new Map()
  return (url, config) => {
    const host = config?.host?.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config?.host
    const key = host ? `http://${host}:${config.port}` : ''
    if (key !== proxyKey) {
      for (const agent of proxyAgents.values()) agent.destroy()
      proxyAgents.clear()
      proxyKey = key
    }
    if (!key) return undefined
    const secure = /^https:/.test(url)
    if (!proxyAgents.has(secure)) {
      const Agent = secure ? HttpsProxyAgent : HttpProxyAgent
      proxyAgents.set(secure, new Agent(key, { keepAlive: true, maxSockets: 8, maxFreeSockets: 2, timeout: 15000 }))
    }
    return proxyAgents.get(secure)
  }
}


export const requestWithDeadline = (url, options, callback) => {
  let data
  if (options.body) {
    data = options.body
  } else if (options.form) {
    data = options.form
    // data.content_type = 'application/x-www-form-urlencoded'
    options.json = false
  } else if (options.formData) {
    data = options.formData
    // data.content_type = 'multipart/form-data'
    options.json = false
  }
  options.response_timeout = options.timeout
  options.parse_response = false
  let completed = false
  let timer
  const finish = (err, resp, body) => {
    if (completed) return
    completed = true
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
    if (!err) {
      // Needle already decompresses and decodes declared character sets.
      // Parse once here, including JSON served with an incorrect content type.
      body = Buffer.isBuffer(body) ? body.toString() : body
      if (typeof body === 'string') {
        try { body = JSON.parse(body) } catch (_) {}
      }
      resp.body = body
    }
    callback(err, resp, body)
  }
  const onAbort = () => abort(options.signal.reason?.message ? options.signal.reason : cancellationError())
  throwIfRequestCancelled(options.signal)
  const stream = needle.request(options.method || 'get', url, data, options, finish)
  // Needle's response timeout ends at the headers. Keep one deadline across
  // redirects and the entire body, including a server that only drips bytes.
  const abort = err => {
    if (completed) return
    try { finish(err) } finally { stream.request?.abort() }
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.timeout > 0) {
    timer = setTimeout(() => {
      const error = new Error('请求超时')
      error.code = 'ETIMEDOUT'
      abort(error)
    }, options.timeout)
  }
  return { abort: () => abort(cancellationError()) }
}
