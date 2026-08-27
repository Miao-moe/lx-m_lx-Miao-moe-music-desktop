import { httpFetch } from '../../request'
import { decodeName } from '../../index'
import { createHttpFetch } from './util'

const getImage = value => value ? value.replace('{size}', '400') : ''
const getId = value => value == null ? '' : String(value)

// msearch.kugou.com 的响应可能带有 <!--KG_TAG_RES_START-->/<!--KG_TAG_RES_END--> 标记，导致 JSON 解析失败
const parseBody = (body) => {
  if (typeof body != 'string') return body
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Search failed')
  return JSON.parse(body.slice(start, end + 1))
}

// 歌手搜索接口不返回头像，通过歌手信息接口批量补齐
const fillSingerAvatars = async(list) => {
  await Promise.all(list.map(async item => {
    try {
      const info = await createHttpFetch(`http://mobilecdn.kugou.com/api/v3/singer/info?singerid=${item.id}&plat=0&version=7900`)
      const img = getImage(info?.imgurl)
      if (img) item.img = img
    } catch {}
  }))
}

export default {
  limit: 18,
  search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const endpoint = type == 'singer' ? 'singer' : 'album'
    const url = `https://msearch.kugou.com/api/v3/search/${endpoint}?version=9108&iscorrection=1&highlight=em&plat=0&keyword=${encodeURIComponent(str)}&pagesize=${limit}&page=${page}&sver=2&with_res_tag=1`

    return httpFetch(url).promise.then(async({ body }) => {
      body = parseBody(body)
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

      if (type == 'singer') await fillSingerAvatars(list)

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
