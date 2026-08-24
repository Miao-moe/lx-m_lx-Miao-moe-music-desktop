import { httpFetch } from '../../request'
import { decodeName } from '../../index'

const getImage = (value, base = '') => {
  if (!value) return ''
  return /^https?:/.test(value) ? value : `${base}${value}`
}
const getId = value => value == null ? '' : String(value)

export default {
  limit: 18,
  search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const itemset = type == 'singer' ? 'artist_2015' : 'web_2013'
    const url = `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${limit}&ft=${type == 'singer' ? 'artist' : 'album'}&itemset=${itemset}&encoding=utf8&rformat=json&mobi=1`

    return httpFetch(url).promise.then(({ body }) => {
      if (!body) throw new Error('Search failed')
      const rawList = type == 'singer' ? body.abslist : body.albumlist
      const list = (rawList || []).map(item => type == 'singer'
        ? {
            play_count: '',
            id: getId(item.ARTISTID || item.DC_TARGETID),
            author: decodeName(item.AARTIST || item.COUNTRY || ''),
            name: decodeName(item.ARTIST),
            img: getImage(item.PICPATH, body.BASEPICPATH),
            desc: decodeName(item.desc || ''),
            source: 'kw',
            total: item.SONGNUM == null ? undefined : String(item.SONGNUM),
          }
        : {
            play_count: '',
            id: getId(item.albumid || item.id),
            author: decodeName(item.artist || item.aartist || ''),
            name: decodeName(item.name),
            time: item.pub || item.showtime || '',
            img: getImage(item.hts_img || item.img || item.pic, body.BASEPICPATH),
            desc: decodeName(item.info || ''),
            source: 'kw',
            total: item.musiccnt == null ? undefined : String(item.musiccnt),
          }).filter(item => item.id && item.name)
      const total = parseInt(type == 'singer' ? body.TOTAL : body.total ?? body.TOTAL) || 0

      return {
        list,
        allPage: Math.max(list.length ? 1 : 0, Math.ceil(total / limit)),
        limit,
        total,
        source: 'kw',
      }
    })
  },
}
