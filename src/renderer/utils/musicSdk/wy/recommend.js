/**
 * 网易云音乐 主页推荐歌单（个人定向）
 *
 * 通过项目指定的 Enhanced REST 服务（见 api-cookie.js）调用 /personalized：
 *  - 已设置 Cookie（登录）时：返回登录用户主页的个性化推荐歌单
 *  - 未设置 Cookie 时：返回通用推荐歌单
 */
import { apiGet } from './api-cookie'
import { getCookie } from '../../cookieManager'

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
    return apiGet('/personalized', { limit: String(limit) }, getCookie('wy')).then(body => ({
      list: filterList(body.result),
      total: body.result?.length ?? 0,
      limit,
      source: 'wy',
    }))
  },
}
