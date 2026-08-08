import { httpFetch } from '../../request'

export default {
  getPic(songInfo, tryNum = 0) {
    if (tryNum > 2) return Promise.reject(new Error('try max num'))
    // 专辑封面接口（imgurl 带 {size} 占位）
    if (songInfo.albumId) {
      const requestObj = httpFetch(`http://mobilecdn.kugou.com/api/v3/album/info?albumid=${songInfo.albumId}&plat=0&version=7900`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      })
      return requestObj.promise.then(({ body }) => {
        const imgurl = body.data?.imgurl
        if (!imgurl) return Promise.reject(new Error('Pic get failed'))
        return imgurl.replace('{size}', '480')
      }).catch(() => this.getPic(songInfo, ++tryNum))
    }
    return Promise.reject(new Error('Pic get failed'))
  },
}
