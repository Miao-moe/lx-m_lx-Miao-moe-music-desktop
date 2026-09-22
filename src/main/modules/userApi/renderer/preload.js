import { contextBridge, ipcRenderer, webFrame } from 'electron'
import zlib from 'zlib'
import { createCipheriv, publicEncrypt, constants, randomBytes, createHash } from 'crypto'
import USER_API_RENDERER_EVENT_NAME from '../rendererEvent/name'
import { createProxyAgentPool, requestWithDeadline } from '@common/utils/needleRequest'
import { getRequestSignal, withRequestScope } from '@common/utils/requestContext'
import { installConsoleRedaction } from '@common/sensitive'

installConsoleRedaction()


const sendMessage = (action, data, status, message) => {
  ipcRenderer.send(action, { data, status, message })
}

let isInitedApi = false
const proxy = {
  host: '',
  port: '',
}
let isShowedUpdateAlert = false
const EVENT_NAMES = {
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
}
const eventNames = Object.values(EVENT_NAMES)
const events = {
  request: null,
}
const allSources = ['kw', 'kg', 'tx', 'wy', 'mg', 'local']
const supportQualitys = {
  kw: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
  kg: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
  tx: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
  wy: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
  mg: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
  local: [],
}
const supportActions = {
  kw: ['musicUrl'],
  kg: ['musicUrl'],
  tx: ['musicUrl'],
  wy: ['musicUrl'],
  mg: ['musicUrl'],
  xm: ['musicUrl'],
  local: ['musicUrl', 'lyric', 'pic'],
}

const requestAgent = createProxyAgentPool()
const requestControllers = new Map()

const getScriptRequestScope = () => {
  const inherited = getRequestSignal()
  const signals = inherited ? [inherited] : [...requestControllers.values()].map(controller => controller.signal)
  if (signals.length < 2) return { signal: signals[0], release() {} }

  // Chromium promises across contextBridge do not retain Node's async context.
  // An unattributed transport may belong to any currently running script call;
  // keep it until all of those consumers finish, without cancelling another song.
  const controller = new AbortController()
  const onAbort = () => {
    if (signals.every(signal => signal.aborted)) controller.abort()
  }
  for (const signal of signals) signal.addEventListener('abort', onAbort, { once: true })
  onAbort()
  return {
    signal: controller.signal,
    release() {
      for (const signal of signals) signal.removeEventListener('abort', onAbort)
    },
  }
}

const verifyLyricInfo = (info) => {
  if (typeof info != 'object' || typeof info.lyric != 'string') throw new Error('failed')
  if (info.lyric.length > 51200) throw new Error('failed')
  return {
    lyric: info.lyric,
    tlyric: (typeof info.tlyric == 'string' && info.tlyric.length < 5120) ? info.tlyric : null,
    rlyric: (typeof info.rlyric == 'string' && info.rlyric.length < 5120) ? info.rlyric : null,
    lxlyric: (typeof info.lxlyric == 'string' && info.lxlyric.length < 8192) ? info.lxlyric : null,
  }
}

const handleRequest = (context, { requestKey, data }) => {
  // console.log(data)
  if (!events.request) return sendMessage(USER_API_RENDERER_EVENT_NAME.response, { requestKey }, false, 'Request event is not defined')
  requestControllers.get(requestKey)?.abort()
  const controller = new AbortController()
  requestControllers.set(requestKey, controller)
  try {
    withRequestScope(controller.signal, () => events.request.call(context, { source: data.source, action: data.action, info: data.info })).then(response => {
      let sendData = {
        requestKey,
      }
      switch (data.action) {
        case 'musicUrl':
          if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed')
          sendData.result = {
            source: data.source,
            action: data.action,
            data: {
              type: data.info.type,
              url: response,
            },
          }
          break
        case 'lyric':
          sendData.result = {
            source: data.source,
            action: data.action,
            data: verifyLyricInfo(response),
          }
          break
        case 'pic':
          if (typeof response != 'string' || response.length > 2048 || !/^https?:/.test(response)) throw new Error('failed')
          sendData.result = {
            source: data.source,
            action: data.action,
            data: response,
          }
          break
      }
      sendMessage(USER_API_RENDERER_EVENT_NAME.response, sendData, true)
    }).catch(err => {
      sendMessage(USER_API_RENDERER_EVENT_NAME.response, { requestKey }, false, err.message)
    }).finally(() => {
      if (requestControllers.get(requestKey) === controller) requestControllers.delete(requestKey)
      controller.abort()
    })
  } catch (err) {
    sendMessage(USER_API_RENDERER_EVENT_NAME.response, { requestKey }, false, err.message)
  }
}

/**
 *
 * @param {*} context
 * @param {*} info {
 *                    openDevTools: false,
 *                    message: 'xxx',
 *                    sources: {
 *                         kw: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
 *                         kg: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
 *                         tx: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'atmos_plus', 'master'],
 *                         wy: ['128k', '320k', 'flac', 'flac24bit', 'hires', 'atmos', 'master'],
 *                         mg: ['128k', '320k', 'flac', 'flac24bit', 'hires'],
 *                     }
 *                 }
 */
const handleInit = (context, info) => {
  if (!info) {
    sendMessage(USER_API_RENDERER_EVENT_NAME.init, null, false, 'Missing required parameter init info')
    // sendMessage(USER_API_RENDERER_EVENT_NAME.init, false, null, typeof info.message === 'string' ? info.message.substring(0, 100) : '')
    return
  }
  if (info.openDevTools === true) {
    sendMessage(USER_API_RENDERER_EVENT_NAME.openDevTools)
  }
  // if (!info.status) {
  //   sendMessage(USER_API_RENDERER_EVENT_NAME.init, null, false, 'Missing required parameter init info')
  //   // sendMessage(USER_API_RENDERER_EVENT_NAME.init, false, null, typeof info.message === 'string' ? info.message.substring(0, 100) : '')
  //   return
  // }
  const sourceInfo = {
    sources: {},
  }
  try {
    for (const source of allSources) {
      const userSource = info.sources[source]
      if (!userSource || userSource.type !== 'music') continue
      const qualitys = supportQualitys[source]
      const actions = supportActions[source]
      sourceInfo.sources[source] = {
        type: 'music',
        actions: actions.filter(a => userSource.actions.includes(a)),
        qualitys: qualitys.filter(q => userSource.qualitys.includes(q)),
      }
    }
  } catch (error) {
    console.log(error)
    sendMessage(USER_API_RENDERER_EVENT_NAME.init, null, false, error.message)
    return
  }
  sendMessage(USER_API_RENDERER_EVENT_NAME.init, sourceInfo, true)

  ipcRenderer.on(USER_API_RENDERER_EVENT_NAME.request, (event, data) => {
    handleRequest(context, data)
  })
  ipcRenderer.on(USER_API_RENDERER_EVENT_NAME.cancelRequest, (_event, requestKey) => {
    requestControllers.get(requestKey)?.abort()
  })
}

const handleShowUpdateAlert = (data, resolve, reject) => {
  if (!data || typeof data != 'object') return reject(new Error('parameter format error.'))
  if (!data.log || typeof data.log != 'string') return reject(new Error('log is required.'))
  if (data.updateUrl && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(data.updateUrl) && data.updateUrl.length > 1024) delete data.updateUrl
  if (data.log.length > 1024) data.log = data.log.substring(0, 1024) + '...'
  sendMessage(USER_API_RENDERER_EVENT_NAME.showUpdateAlert, {
    log: data.log,
    updateUrl: data.updateUrl,
  })
  resolve()
}

const onError = (errorMessage) => {
  if (isInitedApi) return
  isInitedApi = true
  if (errorMessage.length > 1024) errorMessage = errorMessage.substring(0, 1024) + '...'
  sendMessage(USER_API_RENDERER_EVENT_NAME.init, null, false, errorMessage)
}

const initEnv = (userApi) => {
  proxy.host = userApi.proxy.host
  proxy.port = userApi.proxy.port

  contextBridge.exposeInMainWorld('lx', {
    EVENT_NAMES,
    request(url, { method = 'get', timeout, headers, body, form, formData }, callback) {
      const agent = requestAgent(url, proxy)
      const scope = getScriptRequestScope()
      let options = {
        headers,
        agent,
        signal: scope.signal,
        method,
        timeout: typeof timeout == 'number' && timeout > 0 ? Math.min(timeout, 60_000) : 60_000,
      }
      if (body) {
        options.body = body
      } else if (form) {
        options.form = form
        // data.content_type = 'application/x-www-form-urlencoded'
        options.json = false
      } else if (formData) {
        options.formData = formData
        // data.content_type = 'multipart/form-data'
        options.json = false
      }
      let request
      try {
        request = requestWithDeadline(url, options, (err, resp, body) => {
          scope.release()
          // console.log(err, resp, body)
          try {
            if (err) {
              callback.call(this, err, null, null)
            } else {
              callback.call(this, err, {
                statusCode: resp.statusCode,
                statusMessage: resp.statusMessage,
                headers: resp.headers,
                bytes: resp.bytes,
                raw: resp.raw,
                body,
              }, body)
            }
          } catch (err) {
            onError(err.message)
          }
        })
      } catch (err) {
        scope.release()
        throw err
      }

      return () => {
        request.abort()
      }
    },
    send(eventName, data) {
      return new Promise((resolve, reject) => {
        if (!eventNames.includes(eventName)) return reject(new Error('The event is not supported: ' + eventName))
        switch (eventName) {
          case EVENT_NAMES.inited:
            if (isInitedApi) return reject(new Error('Script is inited'))
            isInitedApi = true
            handleInit(this, data)
            resolve()
            break
          case EVENT_NAMES.updateAlert:
            if (isShowedUpdateAlert) return reject(new Error('The update alert can only be called once.'))
            isShowedUpdateAlert = true
            handleShowUpdateAlert(data, resolve, reject)
            break
          default:
            reject(new Error('Unknown event name: ' + eventName))
        }
      })
    },
    on(eventName, handler) {
      if (!eventNames.includes(eventName)) return Promise.reject(new Error('The event is not supported: ' + eventName))
      switch (eventName) {
        case EVENT_NAMES.request:
          events.request = handler
          break
        default: return Promise.reject(new Error('The event is not supported: ' + eventName))
      }
      return Promise.resolve()
    },
    utils: {
      crypto: {
        aesEncrypt(buffer, mode, key, iv) {
          const cipher = createCipheriv(mode, key, iv)
          return Buffer.concat([cipher.update(buffer), cipher.final()])
        },
        rsaEncrypt(buffer, key) {
          buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
          return publicEncrypt({ key, padding: constants.RSA_NO_PADDING }, buffer)
        },
        randomBytes(size) {
          return randomBytes(size)
        },
        md5(str) {
          return createHash('md5').update(str).digest('hex')
        },
      },
      buffer: {
        from(...args) {
          return Buffer.from(...args)
        },
        bufToString(buf, format) {
          return Buffer.from(buf, 'binary').toString(format)
        },
      },
      zlib: {
        inflate(buf) {
          return new Promise((resolve, reject) => {
            zlib.inflate(buf, (err, data) => {
              if (err) reject(new Error(err.message))
              else resolve(data)
            })
          })
        },
        deflate(data) {
          return new Promise((resolve, reject) => {
            zlib.deflate(data, (err, buf) => {
              if (err) reject(new Error(err.message))
              else resolve(buf)
            })
          })
        },
      },
    },
    currentScriptInfo: {
      name: userApi.name,
      description: userApi.description,
      version: userApi.version,
      author: userApi.author,
      homepage: userApi.homepage,
      rawScript: userApi.script,
    },
    version: '2.0.0',
    env: 'desktop',
    // removeEvent(eventName, handler) {
    //   if (!eventNames.includes(eventName)) return Promise.reject(new Error('The event is not supported: ' + eventName))
    //   let handlers
    //   switch (eventName) {
    //     case EVENT_NAMES.request:
    //       handlers = events.request
    //       break
    //   }
    //   for (let index = 0; index < handlers.length; index++) {
    //     if (handlers[index] === handler) {
    //       handlers.splice(index, 1)
    //       break
    //     }
    //   }
    // },
    // removeAllEvents() {
    //   for (const handlers of Object.values(events)) {
    //     handlers.splice(0, handlers.length)
    //   }
    // },
  })

  contextBridge.exposeInMainWorld('__lx_init_error_handler__', {
    sendError(errorMessage) {
      onError(errorMessage)
    },
  })

  webFrame.executeJavaScript(`(() => {
window.addEventListener('error', (event) => {
  if (event.isTrusted) globalThis.__lx_init_error_handler__.sendError(event.message.replace(/^Uncaught\\sError:\\s/, ''))
})
window.addEventListener('unhandledrejection', (event) => {
  if (!event.isTrusted) return
  const message = typeof event.reason === 'string' ? event.reason : event.reason?.message ?? String(event.reason)
  globalThis.__lx_init_error_handler__.sendError(message.replace(/^Error:\\s/, ''))
})
})()`)

  webFrame.executeJavaScript(userApi.script).catch(_ => _)
}


ipcRenderer.on(USER_API_RENDERER_EVENT_NAME.initEnv, (event, data) => {
  initEnv(data)
})

ipcRenderer.on(USER_API_RENDERER_EVENT_NAME.proxyUpdate, (event, data) => {
  proxy.host = data.host
  proxy.port = data.port
})
