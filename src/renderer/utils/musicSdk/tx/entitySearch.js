import { decodeName } from '../../index'
import { formatSingerName } from '../utils'
import musicSearch from './musicSearch'

const getList = (body, type) => {
  if (type == 'singer') return body?.item_singer || body?.singer?.list || []
  return body?.item_album || body?.album?.list || []
}

const getAlias = item => {
  const alias = item.alias || item.aliases || item.subtitle || ''
  if (!Array.isArray(alias)) return decodeName(alias)
  return decodeName(alias.map(info => typeof info == 'string' ? info : info.name).filter(Boolean).join('、'))
}
const getId = value => value == null ? '' : String(value)

export default {
  limit: 18,
  search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const searchType = type == 'singer' ? 1 : 2

    return musicSearch.musicSearch(str, page, limit, 0, searchType).then((data) => {
      if (!data) throw new Error('Search response data missing')
      const { body, meta } = data
      const list = getList(body, type).map(item => {
        const info = item.basic_info || item
        const mid = info.mid || info.singer_mid || info.album_mid || ''
        if (type == 'singer') {
          return {
            play_count: '',
            id: getId(mid || info.id),
            author: getAlias(info),
            name: decodeName(info.name || info.title || info.singer_name),
            img: mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg` : '',
            desc: decodeName(info.desc || ''),
            source: 'tx',
            total: info.song_num == null && info.songNum == null ? undefined : String(info.song_num ?? info.songNum),
          }
        }
        return {
          play_count: '',
          id: getId(mid || info.id),
          author: formatSingerName(info.singer || info.singer_list || info.author || [], 'name'),
          name: decodeName(info.name || info.title || info.album_name),
          time: info.time_public || info.publish_date || '',
          img: mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : '',
          desc: decodeName(info.desc || ''),
          source: 'tx',
          total: info.song_count == null && info.song_num == null ? undefined : String(info.song_count ?? info.song_num),
        }
      }).filter(item => item.id && item.name)
      const total = Number(meta?.estimate_sum ?? meta?.sum) || list.length

      return {
        list,
        allPage: Math.max(list.length ? 1 : 0, Math.ceil(total / limit)),
        limit,
        total,
        source: 'tx',
      }
    })
  },
}
