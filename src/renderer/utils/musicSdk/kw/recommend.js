/**
 * 酷我音乐 主页「猜你喜欢」推荐歌单（个人定向）
 *
 * 已设置 Cookie（kw_token）时调用 www.kuwo.cn 的 rcm 推荐接口（需 csrf 头，取自 kw_token）：
 *  未设置 Cookie 或请求失败时降级为 PC 端推荐歌单（getRcmPlayList）
 */
import { httpFetch } from '../../request'
import { getCookie, hasCookie, getCookieValue } from '../../cookieManager'

const formatPlayCount = (num) => {
  if (num == null) return ''
  if (num > 100000000) return `${parseInt(num / 10000000) / 10}亿`
  if (num > 10000) return `${parseInt(num / 1000) / 10}万`
  return String(num)
}

const filterRcmList = (rawList) => (rawList ?? []).map(item => ({
  id: String(item.id),
  name: item.name,
  img: item.img,
  author: item.uname ?? '',
  play_count: formatPlayCount(item.listencnt),
  total: String(item.total ?? ''),
  desc: item.desc ?? '',
  source: 'kw',
}))

export default {
  limit: 30,
  successCode: 200,

  // 主页「猜你喜欢」推荐歌单（需登录 Cookie）
  getRcmIndexList(page, limit, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    return httpFetch(`http://www.kuwo.cn/api/www/rcm/index/songlist?pn=${page}&rn=${limit}&httpsStatus=1`, {
      headers: {
        Referer: 'http://www.kuwo.cn/',
        'User-Agent': 'Mozilla/5.0',
        Cookie: getCookie('kw'),
        csrf: getCookieValue(getCookie('kw'), 'kw_token') ?? '',
      },
    }).promise.then(({ body }) => {
      if (body.code !== this.successCode || !body.data?.list) return this.getRcmIndexList(page, limit, ++tryNum)
      return {
        list: filterRcmList(body.data.list),
        total: body.data.total ?? body.data.list.length,
        limit,
        source: 'kw',
      }
    })
  },

  // PC 端推荐歌单（无需登录，作为兜底）
  getRcmPlayList(page, limit, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    return httpFetch(`http://wapi.kuwo.cn/api/pc/classify/playlist/getRcmPlayList?loginUid=0&loginSid=0&appUid=76039576&pn=${page}&rn=${limit}&order=hot`)
      .promise.then(({ body }) => {
        if (body.code !== this.successCode || !body.data?.data) return this.getRcmPlayList(page, limit, ++tryNum)
        const rawList = body.data.data
        return {
          list: rawList.map(item => ({
            id: `digest-${item.digest}__${item.id}`,
            name: item.name,
            img: item.img,
            author: item.uname ?? '',
            play_count: formatPlayCount(item.listencnt),
            total: String(item.total ?? ''),
            desc: item.desc ?? '',
            source: 'kw',
          })),
          total: body.data.total ?? rawList.length,
          limit,
          source: 'kw',
        }
      })
  },

  /**
   * 获取酷我音乐主页推荐歌单
   * 已设置 Cookie 时返回「猜你喜欢」个人定向推荐，否则返回 PC 端推荐歌单
   */
  getRecommendList(page = 1, limit = this.limit) {
    if (hasCookie('kw')) {
      return this.getRcmIndexList(page, limit).catch(() => this.getRcmPlayList(page, limit))
    }
    return this.getRcmPlayList(page, limit)
  },
}
