import { eapiRequest, weapiRequest } from './utils/index'
import { formatPlayTime, sizeFormate } from '../../index'
import { formatSingerName } from '../utils'

export default {
  /**
   * 获取歌手信息
   * @param {*} id
   */
  async getInfo(id) {
    let body
    try {
      body = (await eapiRequest('/api/artist/head/info/get', { id }).promise).body
    } catch (error) {
      console.log(error)
    }

    let desc = body?.artist?.briefDesc ?? ''
    if (!desc) {
      try {
        const introduction = await weapiRequest('/artist/introduction', { id: Number(id) || id }).promise
        if (introduction.body?.code == 200) {
          desc = (introduction.body.introduction ?? []).map(item => item.txt || '').filter(Boolean).join('\n\n')
        }
      } catch (error) {
        console.log(error)
      }
    }
    if (!body?.artist && !desc) throw new Error('get singer info faild.')

    return {
      source: 'wy',
      id: body?.artist?.id ?? id,
      info: {
        name: body?.artist?.name ?? '',
        desc,
        avatar: body?.user?.avatarUrl ?? body?.artist?.cover ?? body?.artist?.picUrl ?? '',
        gender: body?.user?.gender === 1 ? 'man' : 'woman',
      },
      count: {
        music: body?.artist?.musicSize,
        album: body?.artist?.albumSize,
      },
    }
  },
  /**
   * 获取歌手歌曲列表
   * @param {*} id
   * @param {*} page
   * @param {*} limit
   */
  getSongList(id, page = 1, limit = 100) {
    return eapiRequest('/api/v2/artist/songs', {
      id,
      limit,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (!body.songs || body.code != 200) throw new Error('get singer song list faild.')

      const list = this.filterSongList(body.songs)
      return {
        list,
        limit,
        page,
        total: body.total,
        source: 'wy',
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
    return eapiRequest(`/api/artist/albums/${id}`, {
      limit,
      offset: limit * (page - 1),
    }).promise.then(({ body }) => {
      if (!body.hotAlbums || body.code != 200) throw new Error('get singer album list faild.')

      const list = this.filterAlbumList(body.hotAlbums)
      return {
        source: 'wy',
        list,
        limit,
        page,
        total: body.artist.albumSize,
      }
    })
  },
  filterAlbumList(raw) {
    const list = []
    raw.forEach(item => {
      if (!item.id) return
      list.push({
        id: item.id,
        count: item.size,
        info: {
          name: item.name,
          author: formatSingerName(item.artists),
          img: item.picUrl,
          desc: null,
        },
      })
    })
    return list
  },
  filterSongList(raw) {
    const list = []
    raw.forEach(item => {
      if (!item.id) return

      const duration = item.dt ?? item.duration

      const types = []
      const _types = {}
      item.privilege?.chargeInfoList?.forEach(i => {
        let type
        let music
        switch (i.rate) {
          case 128000:
          case 192000:
            type = '128k'
            music = item.lMusic
            break
          case 320000:
            type = '320k'
            music = item.hMusic
            break
          case 999000:
            type = 'flac'
            music = item.sqMusic
            break
          case 1999000:
            type = 'flac24bit'
            music = item.hrMusic
            break
        }
        if (!type || _types[type]) return
        const size = music ? sizeFormate(music.size) : null
        types.push({ type, size })
        _types[type] = { size }
      })

      list.push({
        singer: formatSingerName(item.artists),
        name: item.name,
        albumName: item.album.name,
        albumId: item.album.id,
        songmid: item.id,
        source: 'wy',
        interval: duration ? formatPlayTime(duration / 1000) : null,
        img: null,
        lrc: null,
        otherSource: null,
        types,
        _types,
        typeUrl: {},
      })
    })
    return list
  },
}
