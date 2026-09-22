import { httpFetch } from '../../../request'
import { throwIfRequestCancelled } from '../../../requestContext'
import { providerError, retryProviderRequest } from '../../requestErrors'

/**
 * 创建一个适用于MG的Http请求
 * @param {*} url
 * @param {*} options
 * @param {*} retryNum
 */
export const createHttpFetch = async(url, options) => retryProviderRequest(async() => {
  throwIfRequestCancelled()
  const result = await httpFetch(url, options).promise
  const code = result.body?.code ?? result.body?.returnCode
  if (result.statusCode !== 200 || code !== '000000') throw providerError('mg', code, result.statusCode)
  if (result.body.data) return result.body.data
  return result.body
})
