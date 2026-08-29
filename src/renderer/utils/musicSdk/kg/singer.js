import { decodeName, formatPlayTime, sizeFormate } from '../../index'
import { createHttpFetch } from './util'

const getImage = value => value ? value.replace('{size}', '480') : null

export const filterSongList = (rawList) => {
  const hashs = new Set()
  const list = []
  for (const item of rawList) {
    if (!item?.hash || hashs.has(item.hash)) continue
    hashs.add(item.hash)
    const types = []
    const _types = {}
    if (item.filesize) {
      const size = sizeFormate(parseInt(item.filesize))
      types.push({ type: '128k', size, hash: item.hash })
      _types['128k'] = { size, hash: item.hash }
    }
    if (item['320filesize'] && item['320hash']) {
      const size = sizeFormate(parseInt(item['320filesize']))
      types.push({ type: '320k', size, hash: item['320hash'] })
      _types['320k'] = { size, hash: item['320hash'] }
    }
    if (item.sqfilesize && item.sqhash) {
      const size = sizeFormate(parseInt(item.sqfilesize))
      types.push({ type: 'flac', size, hash: item.sqhash })
      _types.flac = { size, hash: item.sqhash }
    }
    if (item.filesize_high && item.hash_high) {
      const size = sizeFormate(parseInt(item.filesize_high))
      types.push({ type: 'flac24bit', size, hash: item.hash_high })
      _types.flac24bit = { size, hash: item.hash_high }
    }
    const fileName = decodeName(item.filename ?? '')
    const separatorIndex = fileName.indexOf(' - ')
    list.push({
      singer: separatorIndex == -1 ? '' : fileName.slice(0, separatorIndex).trim(),
      name: (separatorIndex == -1 ? fileName : fileName.slice(separatorIndex + 3)).trim(),
      albumName: decodeName(item.album_name ?? ''),
      albumId: item.album_id,
      songmid: item.audio_id,
      source: 'kg',
      interval: formatPlayTime(item.duration),
      img: getImage(item.trans_param?.union_cover),
      lrc: null,
      hash: item.hash,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    })
  }
  return list
}

export default {
  /**
   * 获取歌手信息
   * @param {*} id
   */
  getInfo(id) {
    if (id == 0) throw new Error('歌手不存在') // kg源某些歌曲在歌手没被kg收录时返回的歌手id为0
    return createHttpFetch(`http://mobiles.kugou.com/api/v5/singer/info?singerid=${id}`).then(body => {
      if (!body) throw new Error('get singer info faild.')

      return {
        source: 'kg',
        id: body.singerid,
        info: {
          name: body.singername,
          desc: body.intro,
          avatar: body.imgurl.replace('{size}', 480),
          gender: body.grade === 1 ? 'man' : 'woman',
        },
        count: {
          music: body.songcount,
          album: body.albumcount,
        },
      }
    })
  },
  /**
   * 获取歌手专辑列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  getAlbumList(id, page = 1, limit = 10) {
    if (id == 0) throw new Error('歌手不存在')
    return createHttpFetch(`http://mobiles.kugou.com/api/v5/singer/album?singerid=${id}&page=${page}&pagesize=${limit}`).then(body => {
      if (!body.info) throw new Error('get singer album list faild.')

      const list = this.filterAlbumList(body.info)
      return {
        source: 'kg',
        list,
        limit,
        page,
        total: body.total,
      }
    })
  },
  /**
   * 获取歌手歌曲列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  async getSongList(id, page = 1, limit = 100) {
    if (id == 0) throw new Error('歌手不存在')
    const body = await createHttpFetch(`http://mobiles.kugou.com/api/v5/singer/song?singerid=${id}&page=${page}&pagesize=${limit}`)
    if (!body.info) throw new Error('get singer song list faild.')

    return {
      source: 'kg',
      list: filterSongList(body.info),
      limit,
      page,
      total: body.total,
    }
  },
  filterAlbumList(raw) {
    return raw.map(item => {
      return {
        id: item.albumid,
        count: item.songcount,
        info: {
          name: item.albumname,
          author: item.singername,
          img: item.replaceAll('{size}', '480'),
          desc: item.intro,
        },
      }
    })
  },
}
