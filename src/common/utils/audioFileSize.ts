import http from 'node:http'
import https from 'node:https'

type AgentFactory = (url: string) => http.Agent | undefined

const parseSize = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value)) return null
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 ? size : null
}

const getResponseSize = (response: http.IncomingMessage, method: 'HEAD' | 'GET'): number | null => {
  if (response.statusCode === 206 && method === 'GET') {
    const total = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(response.headers['content-range'] ?? '')?.[1]
    return parseSize(total)
  }
  return response.statusCode === 200 ? parseSize(response.headers['content-length']) : null
}

const requestSize = async(url: string, method: 'HEAD' | 'GET', signal: AbortSignal, getAgent: AgentFactory, redirects = 0): Promise<number | null> => {
  if (redirects > 5) return Promise.resolve(null)
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http
    const request = transport.request(target, {
      method,
      signal,
      agent: getAgent(url),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
        ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}),
      },
    }, response => {
      const location = response.headers.location
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.destroy()
        resolve(requestSize(new URL(location, target).toString(), method, signal, getAgent, redirects + 1))
        return
      }
      const size = getResponseSize(response, method)
      // A server may ignore Range and start sending the full audio file.
      response.destroy()
      resolve(size)
    })
    request.on('error', reject)
    request.end()
  })
}

export const probeAudioFileSize = async(url: string, signal: AbortSignal, getAgent: AgentFactory = () => undefined): Promise<number | null> => {
  try {
    const size = await requestSize(url, 'HEAD', signal, getAgent)
    if (size != null) return size
  } catch (error) {
    if (signal.aborted) throw error
  }
  return requestSize(url, 'GET', signal, getAgent)
}
