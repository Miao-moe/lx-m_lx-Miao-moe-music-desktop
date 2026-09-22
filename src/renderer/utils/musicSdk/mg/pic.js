import { getMusicInfo } from './musicInfo'

export default {
  async getPic(songInfo) {
    if (typeof songInfo.img === 'string' && /^(https?:)?\/\//.test(songInfo.img)) return songInfo.img.startsWith('//') ? 'https:' + songInfo.img : songInfo.img
    const info = await getMusicInfo(songInfo.songmid)
    const url = info?.img
    if (typeof url != 'string' || !/^(https?:)?\/\//.test(url)) throw new Error('图片获取失败')
    return url.startsWith('//') ? 'https:' + url : url
  },
}
