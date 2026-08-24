import { httpFetch } from '../../request'
import { decodeName } from '../../index'

const getImage = value => value ? value.replace('{size}', '400') : ''
const getId = value => value == null ? '' : String(value)

export default {
  limit: 18,
  search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const endpoint = type == 'singer' ? 'singer' : 'album'
    const url = `https://msearch.kugou.com/api/v3/search/${endpoint}?version=9108&iscorrection=1&highlight=em&plat=0&keyword=${encodeURIComponent(str)}&pagesize=${limit}&page=${page}&sver=2&with_res_tag=1`

    return httpFetch(url).promise.then(({ body }) => {
      if (!body || body.status !== 1) throw new Error(body?.error || 'Search failed')
      const resultData = body.data || {}
      const rawList = type == 'singer'
        ? (Array.isArray(resultData) ? resultData : resultData.info || [])
        : resultData.info || []
      const list = rawList.map(item => type == 'singer'
        ? {
            play_count: '',
            id: getId(item.singerid),
            author: '',
            name: decodeName(item.singername),
            img: getImage(item.imgurl),
            desc: decodeName(item.intro || ''),
            source: 'kg',
            total: item.songcount == null ? undefined : String(item.songcount),
          }
        : {
            play_count: '',
            id: getId(item.albumid),
            author: decodeName(item.singername || ''),
            name: decodeName(item.albumname),
            time: item.publishtime || '',
            img: getImage(item.imgurl),
            desc: decodeName(item.intro || ''),
            source: 'kg',
            total: item.songcount == null ? undefined : String(item.songcount),
          }).filter(item => item.id && item.name)
      const total = type == 'singer'
        ? (Array.isArray(resultData) ? list.length : Number(resultData.total) || list.length)
        : Number(resultData.total) || 0

      return {
        list,
        allPage: Math.max(list.length ? 1 : 0, Math.ceil(total / limit)),
        limit,
        total,
        source: 'kg',
      }
    })
  },
}
