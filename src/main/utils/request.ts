// import progress from 'request-progress'
import { request, type Options } from '@common/utils/request'
import { withRequestMessage } from '@common/utils/requestError'
// import fs from 'fs'

export const requestMsg = {
  fail: '请求异常😮，可以多试几次，若还是不行就换一首吧。。。',
  unachievable: '哦No😱...接口无法访问了！',
  timeout: '请求超时',
  // unachievable: '哦No😱...接口无法访问了！已帮你切换到临时接口，重试下看能不能播放吧~',
  notConnectNetwork: '无法连接到服务器',
  cancelRequest: '取消http请求',
} as const

// var proxyUrl = "http://" + user + ":" + password + "@" + host + ":" + port;
// var proxiedRequest = request.defaults({'proxy': proxyUrl});

// interface RequestPromise extends Promise<RequestResponse> {
//   abort: () => void
// }

/**
 * 请求超时自动重试
 * @param {*} url
 * @param {*} options
 */
export const httpFetch = async<T = unknown> (url: string, options: Options) => {
  return request<T>(url, options).catch(async(err: any) => {
    // console.log('出错', err)
    if (err.message === 'socket hang up') {
      // window.globalObj.apiSource = 'temp'
      throw withRequestMessage(err, requestMsg.unachievable)
    }
    switch (err.code) {
      case 'ETIMEDOUT':
      case 'ESOCKETTIMEDOUT':
      case 'UND_ERR_HEADERS_TIMEOUT':
      case 'UND_ERR_BODY_TIMEOUT':
      case 'UND_ERR_CONNECT_TIMEOUT':
        throw withRequestMessage(err, requestMsg.timeout)
      case 'ENOTFOUND':
        throw withRequestMessage(err, requestMsg.notConnectNetwork)
      default:
        throw err
    }
  })
  // requestObj.promise = requestObj.promise.catch(async err => {
  //   // console.log('出错', err)
  //   if (err.message === 'socket hang up') {
  //     // window.globalObj.apiSource = 'temp'
  //     return Promise.reject(new Error(requestMsg.unachievable))
  //   }
  //   switch (err.code) {
  //     case 'ETIMEDOUT':
  //     case 'ESOCKETTIMEDOUT':
  //       return Promise.reject(new Error(requestMsg.timeout))
  //     case 'ENOTFOUND':
  //       return Promise.reject(new Error(requestMsg.notConnectNetwork))
  //     default:
  //       return Promise.reject(err)
  //   }
  // })
  // return requestPromise
}

export type RequestOptions = Options
