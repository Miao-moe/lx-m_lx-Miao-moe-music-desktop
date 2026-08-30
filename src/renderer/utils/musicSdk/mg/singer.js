import { createHttpFetch } from './utils'

const getDescription = (data) => {
  const section = data.contents?.find(item => item.view == 'ZJ-Singer-Intro-Scroll')
  return (section?.contents ?? []).map(item => item.txt2 || item.text || '').filter(Boolean).join('\n\n')
}

export default {
  /**
   * 从歌手主页介绍区块获取简介
   * @param {*} id
   */
  async getInfo(id) {
    const data = await createHttpFetch(`https://app.c.nf.migu.cn/bmw/singer/index/v1.0?singerId=${id}`)
    return {
      source: 'mg',
      id,
      info: {
        desc: getDescription(data),
      },
      count: {},
    }
  },
}
