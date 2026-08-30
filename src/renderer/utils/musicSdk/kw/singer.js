import { httpFetch } from '../../request'
import { decodeName } from '../../index'

const getImage = (info) => {
  const image = info.hts_pic || info.pic || ''
  if (!image || /^https?:/.test(image)) return image
  return `https://img4.kuwo.cn/star/starheads/${image}`
}

export default {
  /**
   * 通过歌手 id 获取歌手详情
   * @param {*} id
   */
  getInfo(id) {
    return httpFetch(`https://search.kuwo.cn/r.s?stype=artistinfo&encoding=utf8&artistid=${id}&pcjson=1`).promise.then(({ statusCode, body }) => {
      if (statusCode !== 200 || !body?.name) throw new Error('get singer info failed.')

      return {
        source: 'kw',
        id: String(body.id ?? id),
        info: {
          name: decodeName(body.name),
          desc: decodeName(body.desc || body.info || ''),
          avatar: getImage(body),
          gender: body.gender == '男' ? 'man' : body.gender == '女' ? 'woman' : '',
        },
        count: {
          music: body.musicnum,
          album: body.albumnum,
        },
      }
    })
  },
}
