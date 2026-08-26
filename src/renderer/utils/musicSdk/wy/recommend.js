/**
 * 网易云音乐 主页推荐歌单（个人定向）
 *
 * 直接调用网易官方 weapi 接口 /weapi/personalized/playlist：
 *  - 已设置 Cookie（登录）时：返回登录用户主页的个性化推荐歌单
 *  - 未设置 Cookie 时：返回通用推荐歌单
 */
import { httpFetch } from '../../request'
import { getCookie, getCookieValue } from '../../cookieManager'
import { weapi } from './utils/crypto'

const formatPlayCount = (num) => {
  if (num == null) return ''
  if (num > 100000000) return `${parseInt(num / 10000000) / 10}亿`
  if (num > 10000) return `${parseInt(num / 1000) / 10}万`
  return String(num)
}

const filterList = (rawList) => (rawList ?? []).map(item => ({
  id: String(item.id),
  name: item.name,
  img: item.picUrl ?? item.coverImgUrl ?? '',
  author: item.creator?.nickname ?? '',
  play_count: formatPlayCount(item.playCount),
  total: '',
  desc: item.description ?? '',
  source: 'wy',
}))

export default {
  limit: 30,
  successCode: 200,

  /**
   * 获取网易云主页推荐歌单
   * 已设置 Cookie 时返回个人定向推荐，否则返回通用推荐
   * @param page 页数（网易云推荐无分页，忽略）
   * @param limit 数量
   */
  getRecommendList(page = 1, limit = this.limit) {
    const cookie = getCookie('wy')
    return httpFetch('https://music.163.com/weapi/personalized/playlist', {
      method: 'post',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
        Origin: 'https://music.163.com',
        Referer: 'https://music.163.com/',
        Cookie: cookie,
      },
      form: weapi({
        limit,
        total: true,
        n: 1000,
        csrf_token: getCookieValue(cookie, '__csrf') ?? '',
      }),
    }).promise.then(({ body, statusCode }) => {
      if (statusCode != 200 || !body || body.code !== this.successCode) throw new Error('获取推荐歌单失败')
      return {
        list: filterList(body.result),
        total: body.result?.length ?? 0,
        limit,
        source: 'wy',
      }
    })
  },
}
