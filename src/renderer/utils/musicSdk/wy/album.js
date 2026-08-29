import { eapiRequest } from './utils/index'
import { dateFormat } from '../../index'

export default {
  /**
   * 通过专辑 id 获取专辑信息
   * @param {*} id
   */
  getAlbumInfo(id) {
    return eapiRequest(`/api/v1/album/${id}`, {}).promise.then(({ body }) => {
      if (!body || body.code != 200 || !body.album) throw new Error('get album info faild.')

      const album = body.album
      return {
        name: album.name ?? '',
        author: album.artist?.name ?? '',
        img: album.picUrl ?? '',
        desc: album.description ?? '',
        time: album.publishTime ? dateFormat(album.publishTime, 'Y-M-D') : '',
        total: album.size,
      }
    })
  },
}
