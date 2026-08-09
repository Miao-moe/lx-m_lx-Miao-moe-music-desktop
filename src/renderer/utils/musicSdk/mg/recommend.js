/**
 * 咪咕音乐 推荐歌单
 * 使用歌单广场推荐接口（playlist-square-recommend），请求携带 Cookie（登录后返回更贴合账号的推荐）
 * 返回为嵌套 contents 结构，需递归展平
 */
import { httpFetch } from '../../request'
import { getCookie } from '../../cookieManager'

export default {
  limit: 30,
  defaultHeaders: {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    Referer: 'https://m.music.migu.cn/',
  },

  getRecommendList(page = 1, limit = this.limit, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    return httpFetch(`https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo=${page}`, {
      headers: {
        ...this.defaultHeaders,
        Cookie: getCookie('mg'),
      },
    }).promise.then(({ body }) => {
      if (body.code !== '000000') return this.getRecommendList(page, limit, ++tryNum)
      const list = this.filterList(body.data?.contents ?? [])
      return {
        list,
        total: list.length,
        limit,
        source: 'mg',
      }
    })
  },
  filterList(listData, list = [], ids = new Set()) {
    for (const item of listData) {
      if (item.contents) this.filterList(item.contents, list, ids)
      else if (item.logEvent?.resourceId && !ids.has(item.logEvent.resourceId)) {
        ids.add(item.logEvent.resourceId)
        list.push({
          id: String(item.logEvent.resourceId),
          name: item.txt ?? '',
          img: item.img ?? '',
          author: '',
          play_count: '',
          total: '',
          desc: item.txt2 ?? '',
          source: 'mg',
        })
      }
    }
    return list
  },
}
