/**
 * 酷狗音乐 推荐歌单
 * 优先使用移动端推荐歌单接口并携带 Cookie；接口不可用时回落到公开热门歌单。
 */
import { httpFetch } from '../../request'
import { getCookie } from '../../cookieManager'
import songList from './songList'

const formatPlayCount = (num) => {
  if (num == null) return ''
  if (num > 100000000) return `${parseInt(num / 10000000) / 10}亿`
  if (num > 10000) return `${parseInt(num / 1000) / 10}万`
  return String(num)
}

export default {
  limit: 30,

  getRecommendList(page = 1, limit = this.limit) {
    return httpFetch(`http://m.kugou.com/plist/index?json=true&page=${page}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Cookie: getCookie('kg'),
      },
    }).promise.then(({ body, statusCode }) => {
      const rawList = body?.plist?.list?.info
      if (statusCode !== 200 || !Array.isArray(rawList) || !rawList.length) throw new Error('酷狗推荐歌单接口无数据')
      const list = rawList.slice(0, limit).map(item => ({
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
        limit,
        source: 'kg',
      }
    }).catch(() => httpFetch(songList.getSongListUrl('6', '', page)).promise.then(({ body, statusCode }) => {
      if (statusCode !== 200 || body?.status !== 1 || !Array.isArray(body.special_db) || !body.special_db.length) {
        throw new Error('酷狗热门歌单接口无数据')
      }
      const list = songList.filterList(body.special_db).slice(0, limit)
      return { list, total: list.length, limit, source: 'kg' }
    }))
  },
}
