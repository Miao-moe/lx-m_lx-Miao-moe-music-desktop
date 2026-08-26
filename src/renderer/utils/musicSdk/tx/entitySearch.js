import { httpFetch } from '../../request'
import { decodeName } from '../../index'
import { formatSingerName } from '../utils'
import musicSearch from './musicSearch'

const getId = value => value == null ? '' : String(value)
const getSingerImage = mid => mid ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${mid}.jpg` : ''
const getAlbumImage = mid => mid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${mid}.jpg` : ''

const searchSuggest = (str) => {
  const url = `https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?format=json&key=${encodeURIComponent(str)}&inCharset=utf8&outCharset=utf-8&platform=yqq`
  return httpFetch(url).promise.then(({ body }) => {
    if (!body || body.code != 0 || !body.data) throw new Error('Search failed')
    return body.data
  })
}

const filterSingerSuggest = (data) => (data.singer?.itemlist ?? []).map(item => {
  const mid = getId(item.mid)
  return {
    play_count: '',
    id: mid,
    author: '',
    name: decodeName(item.name),
    img: getSingerImage(mid),
    desc: '',
    source: 'tx',
    total: undefined,
  }
}).filter(item => item.id && item.name)

const filterAlbumSuggest = (data) => (data.album?.itemlist ?? []).map(item => {
  const mid = getId(item.mid)
  return {
    play_count: '',
    id: mid,
    author: decodeName(item.singer ?? ''),
    name: decodeName(item.name),
    time: '',
    img: getAlbumImage(mid),
    desc: '',
    source: 'tx',
    total: undefined,
  }
}).filter(item => item.id && item.name)

const collectSingersFromSongs = (songs, exists) => {
  const list = []
  for (const song of songs) {
    for (const singer of song.singer ?? []) {
      const mid = getId(singer.mid)
      const name = decodeName(singer.name || singer.title || '')
      if (!mid || !name || exists.has(mid)) continue
      exists.add(mid)
      list.push({
        play_count: '',
        id: mid,
        author: '',
        name,
        img: getSingerImage(mid),
        desc: '',
        source: 'tx',
        total: undefined,
      })
    }
  }
  return list
}

const collectAlbumsFromSongs = (songs, exists) => {
  const list = []
  for (const song of songs) {
    const album = song.album
    const mid = getId(album?.mid)
    const name = decodeName(album?.name || album?.title || '')
    if (!mid || !name || exists.has(mid)) continue
    exists.add(mid)
    list.push({
      play_count: '',
      id: mid,
      author: formatSingerName(song.singer, 'name'),
      name,
      time: album?.time_public ?? '',
      img: getAlbumImage(mid),
      desc: '',
      source: 'tx',
      total: undefined,
    })
  }
  return list
}

export default {
  limit: 18,
  async search(type, str, page = 1, limit) {
    if (limit == null) limit = this.limit
    let list = await searchSuggest(str).then(data => {
      return type == 'singer' ? filterSingerSuggest(data) : filterAlbumSuggest(data)
    }).catch(err => {
      console.log(err)
      return []
    })
    if (!list.length) {
      const exists = new Set()
      list = await musicSearch.musicSearch(str, 1, 50, 0, 0).then((data) => {
        const songs = data?.body?.item_song ?? []
        return type == 'singer' ? collectSingersFromSongs(songs, exists) : collectAlbumsFromSongs(songs, exists)
      })
    }

    return {
      list,
      allPage: 1,
      limit,
      total: list.length,
      source: 'tx',
    }
  },
}
