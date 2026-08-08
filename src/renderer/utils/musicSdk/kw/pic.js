import { httpFetch } from '../../request'
import { getCookie, getCookieValue } from '../../cookieManager'

export default {
  getPic({ songmid }, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    // 网页端歌曲信息接口（需 kw_token Cookie 作为 csrf）
    const cookie = getCookie('kw')
    const csrf = getCookieValue(cookie, 'kw_token')
    if (csrf) {
      const requestObj = httpFetch(`http://www.kuwo.cn/api/www/music/musicInfo?mid=${songmid}`, {
        headers: {
          Referer: 'http://www.kuwo.cn/',
          'User-Agent': 'Mozilla/5.0',
          Cookie: cookie,
          csrf,
        },
      })
      return requestObj.promise.then(({ body }) => {
        if (body.code !== 200 || !body.data?.pic) return Promise.reject(new Error('图片获取失败'))
        return body.data.pic
      }).catch(() => this.getPic({ songmid }, ++tryNum))
    }
    // 旧接口（部分歌曲仍有效）
    const requestObj = httpFetch(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`)
    requestObj.promise = requestObj.promise.then(({ body }) => /^http/.test(body) ? body : null)
    return requestObj.promise
  },
}
