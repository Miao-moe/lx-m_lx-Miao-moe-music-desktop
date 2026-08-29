import { httpFetch } from '../../request'
import { decodeName } from '../../index'

export default {
  /**
   * 通过专辑 mid 获取专辑信息
   * @param {*} mid
   */
  getAlbumInfo(mid, retryNum = 0) {
    if (retryNum > 2) return Promise.reject(new Error('try max num'))
    return httpFetch(`https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?albummid=${mid}&format=json`, {
      headers: {
        Referer: 'https://y.qq.com',
      },
    }).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || !body || body.code != 0 || !body.data) return this.getAlbumInfo(mid, ++retryNum)

      const data = body.data
      return {
        name: decodeName(data.name ?? ''),
        author: decodeName(data.singer_name ?? ''),
        img: mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : '',
        desc: decodeName(data.desc ?? ''),
        time: data.aDate ?? '',
        total: Array.isArray(data.list) ? data.list.length : undefined,
      }
    })
  },
}
