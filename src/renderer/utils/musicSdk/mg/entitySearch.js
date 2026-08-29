import { httpFetch } from '../../request'
import { formatSingerName } from '../utils'
import { createSignature } from './musicSearch'

const getImage = item => {
  let image = item.singerPicUrl?.[0]?.img || item.imgItems?.[0]?.img || item.img || ''
  if (image && !/^https?:/.test(image)) image = `http://d.musicapp.migu.cn${image}`
  return image
}
const getId = value => value == null ? '' : String(value)

export default {
  limit: 18,
  search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    const time = Date.now().toString()
    const signData = createSignature(time, str)
    const searchSwitch = encodeURIComponent(JSON.stringify({
      song: 0,
      album: type == 'album' ? 1 : 0,
      singer: type == 'singer' ? 1 : 0,
      tagSong: 0,
      mvSong: 0,
      bestShow: 0,
      songlist: 0,
      lyricSong: 0,
    }))
    const request = httpFetch(`https://jadeite.migu.cn/music_search/v3/search/searchAll?isCorrect=0&isCopyright=1&searchSwitch=${searchSwitch}&pageSize=${limit}&text=${encodeURIComponent(str)}&pageNo=${page}&sort=0&sid=USS`, {
      headers: {
        uiVersion: 'A_music_3.6.1',
        deviceId: signData.deviceId,
        timestamp: time,
        sign: signData.sign,
        channel: '0146921',
        'User-Agent': 'Mozilla/5.0 (Linux; U; Android 11.0.0; zh-cn; MI 11 Build/OPR1.170623.032) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
      },
    })

    return request.promise.then(({ body }) => {
      if (!body || body.code !== '000000') throw new Error(body?.info || 'Search failed')
      const resultData = body[`${type}ResultData`] || {}
      const rawList = resultData.resultList || resultData.result || []
      const flatList = rawList.flat ? rawList.flat() : rawList
      const list = flatList.map(item => type == 'singer'
        ? {
            play_count: '',
            id: getId(item.id || item.singerId),
            author: item.aliasName || '',
            name: item.name || item.singer,
            img: getImage(item),
            desc: item.desc || '',
            source: 'mg',
            total: item.songCount == null ? undefined : String(item.songCount),
          }
        : {
            play_count: '',
            id: getId(item.id || item.albumId),
            author: item.singer || formatSingerName(item.singers || [], 'name'),
            name: item.name || item.album,
            time: item.publishDate || '',
            img: getImage(item),
            desc: item.desc || '',
            source: 'mg',
            total: item.songCount == null ? undefined : String(item.songCount),
          }).filter(item => item.id && item.name)
      const total = Number(resultData.totalCount) || list.length

      return {
        list,
        allPage: Math.max(list.length ? 1 : 0, Math.ceil(total / limit)),
        limit,
        total,
        source: 'mg',
      }
    })
  },
}
