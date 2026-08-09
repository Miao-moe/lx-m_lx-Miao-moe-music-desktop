/**
 * QQ 音乐 主页推荐歌单（个人定向）
 *
 * 已设置 Cookie（uin + qqmusic_key）时：
 *  调用 music.srfDissInfo.aiRecommendDiss（智能推荐歌单，基于账号听歌习惯）
 * 未设置 Cookie 或请求失败时：
 *  降级为歌单广场「推荐」分类（categoryId=10000000）
 */
import { httpFetch } from '../../request'
import { getCookie, hasCookie } from '../../cookieManager'

const formatPlayCount = (num) => {
  if (num == null) return ''
  if (num > 100000000) return `${parseInt(num / 10000000) / 10}亿`
  if (num > 10000) return `${parseInt(num / 1000) / 10}万`
  return String(num)
}

const filterAiList = (rawList) => (rawList ?? []).map(item => ({
  id: String(item.dissid),
  name: item.dissname,
  img: item.imgurl ?? item.picUrl ?? '',
  author: item.creator?.name ?? '',
  play_count: formatPlayCount(item.listennum ?? item.listen_num),
  total: '',
  desc: item.diss_summary ?? '',
  source: 'tx',
}))

const filterSquareList = (rawList) => (rawList ?? []).map(item => ({
  id: String(item.dissid),
  name: item.dissname,
  img: item.imgurl,
  author: item.creator?.name ?? '',
  play_count: formatPlayCount(item.listennum),
  total: '',
  desc: item.diss_summary ?? '',
  source: 'tx',
}))

export default {
  limit: 20,
  successCode: 0,

  // 个人定向推荐（需登录 Cookie）
  getAiRecommendList(limit, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    const data = JSON.stringify({
      comm: { ct: 24, cv: 0 },
      req_1: { module: 'music.srfDissInfo.aiRecommendDiss', method: 'pc_get_recommend_diss_by_tag', param: { start: 0, num: limit } },
    })
    return httpFetch(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(data)}`, {
      headers: {
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0',
        Cookie: getCookie('tx'),
      },
    }).promise.then(({ body }) => {
      if (body.code !== this.successCode || body.req_1?.code !== this.successCode || !body.req_1?.data?.songList) {
        return this.getAiRecommendList(limit, ++tryNum)
      }
      return {
        list: filterAiList(body.req_1.data.songList),
        total: body.req_1.data.songList.length,
        limit,
        source: 'tx',
      }
    })
  },

  // 歌单广场「推荐」分类（无需登录，作为兜底）
  getSquareRecommendList(page, limit, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    const sin = (page - 1) * limit
    const ein = page * limit - 1
    return httpFetch(`https://c.y.qq.com/splcloud/fcgi-bin/fcg_get_diss_by_tag.fcg?picmid=1&rnd=${Math.random()}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&categoryId=10000000&sortId=5&sin=${sin}&ein=${ein}`, {
      headers: {
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0',
        Cookie: getCookie('tx'),
      },
    }).promise.then(({ body }) => {
      if (body.code !== this.successCode || !body.data?.list) return this.getSquareRecommendList(page, limit, ++tryNum)
      return {
        list: filterSquareList(body.data.list),
        total: body.data.sum ?? body.data.list.length,
        limit,
        source: 'tx',
      }
    })
  },

  /**
   * 获取 QQ 音乐主页推荐歌单
   * 已设置 Cookie 时返回个人定向推荐，否则返回歌单广场推荐分类
   */
  getRecommendList(page = 1, limit = this.limit) {
    if (hasCookie('tx')) {
      return this.getAiRecommendList(limit).catch(() => this.getSquareRecommendList(page, limit))
    }
    return this.getSquareRecommendList(page, limit)
  },
}
