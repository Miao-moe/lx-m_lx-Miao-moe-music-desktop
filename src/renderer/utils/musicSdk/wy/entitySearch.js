import { formatSingerName } from '../utils'
import { eapiRequest } from './utils'

const getId = value => value == null ? '' : String(value)

export default {
  limit: 18,
  search(type, str, page = 1, limit, retryNum = 0) {
    if (++retryNum > 3) return Promise.reject(new Error('try max num'))
    if (limit == null) limit = this.limit
    const request = eapiRequest('/api/cloudsearch/pc', {
      s: str,
      type: type == 'singer' ? 100 : 10,
      limit,
      total: page == 1,
      offset: limit * (page - 1),
    })

    return request.promise.then(({ body }) => {
      if (!body || body.code !== 200) return this.search(type, str, page, limit, retryNum)
      const result = body.result || {}
      const rawList = type == 'singer' ? result.artists : result.albums
      const list = (rawList || []).map(item => type == 'singer'
        ? {
            play_count: '',
            id: getId(item.id),
            author: (item.alias || []).join('、'),
            name: item.name,
            img: item.picUrl || item.img1v1Url || '',
            desc: '',
            source: 'wy',
            total: item.musicSize == null ? undefined : String(item.musicSize),
          }
        : {
            play_count: '',
            id: getId(item.id),
            author: item.artist?.name || formatSingerName(item.artists || [], 'name'),
            name: item.name,
            time: item.publishTime ? new Date(item.publishTime).toLocaleDateString() : '',
            img: item.picUrl || '',
            desc: '',
            source: 'wy',
            total: item.size == null ? undefined : String(item.size),
          }).filter(item => item.id && item.name)
      const total = Number(type == 'singer' ? result.artistCount : result.albumCount) || 0

      return {
        list,
        allPage: Math.max(list.length ? 1 : 0, Math.ceil(total / limit)),
        limit,
        total,
        source: 'wy',
      }
    })
  },
}
