/**
 * 酷狗音乐 推荐歌单
 * 使用移动端推荐歌单接口（m.kugou.com/plist/index），请求携带 Cookie（登录后返回更贴合账号的推荐）
 */
import { httpFetch } from '../../request'
import { getCookie } from '../../cookieManager'

const formatPlayCount = (num) => {
  if (num == null) return ''
  if (num > 100000000) return `${parseInt(num / 10000000) / 10}亿`
  if (num > 10000) return `${parseInt(num / 1000) / 10}万`
  return String(num)
}

export default {
  limit: 30,

  getRecommendList(page = 1) {
    return httpFetch(`http://m.kugou.com/plist/index?json=true&page=${page}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Cookie: getCookie('kg'),
      },
    }).promise.then(({ body }) => {
      const rawList = body.plist?.list?.info ?? []
      const list = rawList.map(item => ({
        id: String(item.specialid),
        name: item.specialname,
        img: (item.imgurl ?? '').replace('{size}', '480'),
        author: item.username ?? '',
        play_count: formatPlayCount(item.playcount),
        total: String(item.songcount ?? ''),
        desc: item.intro ?? '',
        source: 'kg',
      }))
      return {
        list,
        total: list.length,
        limit: this.limit,
        source: 'kg',
      }
    })
  },
}
