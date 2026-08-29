/**
 * 歌曲封面获取工具
 *
 * 歌曲信息自带封面时直接使用；否则按歌曲来源调用对应平台的封面接口
 * （官方内置接口 musicSdk[source].getPic 优先，自定义音源 userApi.apis[source].getPic 兜底），
 * 结果按「source__id」缓存，请求并发受限避免触发平台限流。
 */
import musicSdk from '@renderer/utils/musicSdk'
import { userApi } from '@renderer/store'
import { toOldMusicInfo } from '@renderer/utils'

const coverCache = new Map()
const pending = new Map()
const queue = []
let activeCount = 0
const MAX_CONCURRENT = 5

// 全局封面显示缓存（跨组件持久化）
const coverDisplayCache = new Map()

/**
 * 获取已缓存的封面 URL（同步，可能为空字符串）
 * @param item 歌曲信息
 * @returns 缓存的封面 URL，未缓存时返回空字符串
 */
export const getCachedCoverUrl = (item) => {
  if (item.img || item.meta?.picUrl) return item.img || item.meta?.picUrl
  const key = `${item.source}__${item.id}`
  if (coverDisplayCache.has(key)) return coverDisplayCache.get(key)
  // 尝试从底层缓存获取
  if (coverCache.has(key)) {
    const url = coverCache.get(key)
    if (url) coverDisplayCache.set(key, url)
    return url
  }
  return ''
}

/**
 * 预热封面显示缓存（触发异步获取，结果存入 coverDisplayCache）
 * @param item 歌曲信息
 */
export const prefetchCover = (item) => {
  if (item.img || item.meta?.picUrl) return
  const key = `${item.source}__${item.id}`
  if (coverDisplayCache.has(key) || coverCache.has(key)) return
  getMusicCoverUrl(item).then(url => {
    if (url) coverDisplayCache.set(key, url)
  })
}

/**
 * 获取用于错误判断的 key
 */
export const getCoverKey = (item) => `${item.source}__${item.id}`

const runTask = () => {
  while (activeCount < MAX_CONCURRENT && queue.length) {
    const task = queue.shift()
    activeCount++
    task().finally(() => {
      activeCount--
      runTask()
    })
  }
}

// 兼容三种返回形式：Promise<string>、{ promise }（httpFetch/userApi 请求对象）、普通字符串
const unwrap = (api) => {
  if (!api) return Promise.resolve('')
  if (api.promise) return api.promise
  if (api.then) return api
  return Promise.resolve(api)
}

// 逐个尝试候选接口，返回第一个成功的封面 URL（全部失败返回空字符串）
const tryGetPic = async(candidates) => {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const result = await unwrap(candidate())
      if (typeof result === 'string' && result) return result
    } catch {
      // 尝试下一个
    }
  }
  return ''
}

/**
 * 获取歌曲封面 URL（异步）
 * @param musicInfo 歌曲信息
 * @returns 封面 URL，获取失败或无封面时返回空字符串
 */
export const getMusicCoverUrl = (musicInfo) => {
  if (!musicInfo?.id) return Promise.resolve('')
  // 展开下载项
  const info = musicInfo.metadata ? musicInfo.metadata.musicInfo : musicInfo
  // 歌曲信息自带的封面（新格式 meta.picUrl，旧字段 img）
  const direct = info.meta?.picUrl || info.img
  if (direct) return Promise.resolve(direct)
  const key = `${musicInfo.source}__${musicInfo.id}`
  if (coverCache.has(key)) return Promise.resolve(coverCache.get(key))
  if (pending.has(key)) return pending.get(key)

  const p = new Promise(resolve => {
    queue.push(() => (async function() {
      let url = ''
      try {
        // 各平台 getPic 与自定义音源接口均期望旧格式字段（songmid/albumId/hash 等位于顶层）
        const oldInfo = toOldMusicInfo(info)
        if (oldInfo) {
          const sdk = musicSdk[musicInfo.source]
          const userApiGetPic = userApi.apis?.[musicInfo.source]?.getPic
          // 官方内置接口优先，自定义音源（userApi）仅作失败兜底，兼容所有音源
          const candidates = [
            sdk?.getPic ? () => sdk.getPic(oldInfo) : null,
            userApiGetPic ? () => userApiGetPic(oldInfo) : null,
          ]
          url = await tryGetPic(candidates)
        }
      } catch {
        url = ''
      }
      coverCache.set(key, url)
      pending.delete(key)
      resolve(url)
    })())
    runTask()
  })
  pending.set(key, p)
  return p
}
