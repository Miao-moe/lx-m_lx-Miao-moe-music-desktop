import { toMD5 } from '../utils'
import { httpFetch } from '../../request'
import { providerError, retryProviderRequest } from '../requestErrors'

// s.content[0].lyricContent.forEach(([str]) => {
//   console.log(str)
// })

/**
 * 签名
 * @param {*} params
 * @param {*} apiver
 */
export const signatureParams = (params, platform = 'android', body = '') => {
  let keyparam = 'OIlwieks28dk2k092lksi2UIkp'
  if (platform === 'web') keyparam = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt'
  let param_list = params.split('&')
  param_list.sort()
  let sign_params = `${keyparam}${param_list.join('')}${body}${keyparam}`
  return toMD5(sign_params)
}

/**
 * 创建一个适用于KG的Http请求
 * @param {*} url
 * @param {*} options
 * @param {*} retryNum
 */
export const createHttpFetch = async(url, options) => retryProviderRequest(async() => {
  const result = await httpFetch(url, options).promise
  // console.log(result.statusCode, result.body)
  if (result.statusCode !== 200 ||
    (
      result.body?.error_code ??
      result.body?.errcode ??
      result.body?.err_code) != 0
  ) throw providerError('kg', result.body?.error_code ?? result.body?.errcode ?? result.body?.err_code, result.statusCode)
  if (result.body.data) return result.body.data
  if (Array.isArray(result.body.info)) return result.body
  return result.body.info
})
