import { createHttpFetch } from './util'
import { filterSongList } from './singer'

export default {
  /**
   * 通过AlbumId获取专辑信息
   * @param {*} id
   */
  async getAlbumInfo(id) {
    const albumInfo = await createHttpFetch(`http://mobilecdn.kugou.com/api/v3/album/info?albumid=${id}&plat=0&version=7900`)
    if (!albumInfo) throw new Error('get album info failed.')

    return {
      name: albumInfo.albumname,
      image: albumInfo.imgurl ? albumInfo.imgurl.replace('{size}', 240) : '',
      desc: albumInfo.intro,
      authorName: albumInfo.singername,
    }
  },
  /**
   * 通过AlbumId获取专辑
   * @param {*} id
   * @param {*} page
   */
  async getAlbumDetail(id, page = 1, limit = 200) {
    const albumList = await createHttpFetch(`http://mobiles.kugou.com/api/v3/album/song?version=9108&albumid=${id}&plat=0&pagesize=${limit}&area_code=0&page=${page}&with_res_tag=0`)
    if (!albumList.info) return Promise.reject(new Error('Get album list failed.'))

    const result = filterSongList(albumList.info)

    const info = await this.getAlbumInfo(id).catch(() => null)

    return {
      list: result,
      page,
      limit,
      total: albumList.total,
      source: 'kg',
      info: {
        name: info?.name,
        img: info?.image,
        desc: info?.desc,
        author: info?.authorName,
      },
    }
  },
}
