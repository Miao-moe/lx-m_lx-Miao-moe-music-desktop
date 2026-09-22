import { formatPlayTime, sizeFormate } from '../../index'
import { formatSingerName } from '../utils'
import { signRequest } from './utils'
import { requestMsg } from '../../message'
import { withSearchFallback } from '../searchFallback'
import { buildDesktopSearchRequest, mobileSearch, smartboxSearch } from './searchFallback'
import { requestDelay, shareRequest, throwIfRequestCancelled } from '../../requestContext'

const pendingSearches = new Map()
const retryDelays = [700, 1500]
// Preserve the official LX six-attempt allowance for QQ 2001 responses
// without extending network timeout retries.
const qqSearchRetryDelays = [700, 1500, 1500, 1500, 1500]
const safeCode = value => typeof value == 'number' && Number.isFinite(value)
  ? value
  : typeof value == 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value : null

const responseError = response => {
  const body = response?.body
  const req = body?.['music.search.SearchCgiService'] ?? body?.req
  const details = {
    kind: 'response',
    httpStatus: safeCode(response?.statusCode),
    code: safeCode(body?.code),
    reqCode: safeCode(req?.code),
    bodyType: body == null ? 'empty' : Array.isArray(body) ? 'array' : typeof body,
    hasSongList: Array.isArray(req?.data?.body?.song?.list ?? req?.data?.body?.item_song),
  }
  const error = new Error(`QQ 搜索失败 (HTTP ${details.httpStatus ?? '?'}, code ${details.code ?? '?'}, req.code ${details.reqCode ?? '?'})`)
  error.searchDetails = details
  // Retrying a rejected request immediately only repeats the same failure.
  const status = Number(response?.statusCode)
  error.stopSearchFallback = [401, 403, 429].includes(status)
  error.retryable = (status >= 200 && status < 300) || status >= 500 || status == 408 || status == 429
  const retryAfter = Number(response?.headers?.['retry-after'])
  error.retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0
  if (error.retryAfterMs > 5000) error.retryable = false
  return error
}

const networkError = cause => {
  const code = safeCode(cause?.code)
  const kind = cause?.message == requestMsg.cancelRequest ? 'cancelled' : 'network'
  const details = { kind, networkCode: code }
  const error = new Error(`QQ 搜索失败 (${kind}${code ? ': ' + code : ''})`)
  error.cause = cause
  error.code = code
  error.stopSearchFallback = cause?.stopSearchFallback
  error.searchDetails = details
  error.retryable = cause?.retryable ?? (kind != 'cancelled' && (
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE'].includes(code) ||
    [requestMsg.timeout, requestMsg.notConnectNetwork, requestMsg.unachievable].includes(cause?.message)
  ))
  return error
}

export default {
  limit: 50,
  total: 0,
  page: 0,
  allPage: 1,
  successCode: 0,
  musicSearch(str, page, limit, retryNum = 0, searchType = 0, isDesktop = true, context) {
    const key = JSON.stringify([str, page, limit, searchType, isDesktop, !!context])
    const run = async() => {
      for (let attempt = 0; ; attempt++) {
        throwIfRequestCancelled()
        // Share the allowance across desktop/mobile fallback routes. Direct
        // entity searches retain their existing six-attempt QQ 2001 allowance.
        if (context && context.attempts++ >= 6) throw new Error('QQ search retry budget exhausted')
        const started = Date.now()
        let failure
        try {
          const response = await signRequest(isDesktop ? buildDesktopSearchRequest(str, page, limit, searchType) : {
            comm: {
              ct: '11',
              cv: '14090508',
              v: '14090508',
              tmeAppID: 'qqmusic',
              phonetype: 'EBG-AN10',
              deviceScore: '553.47',
              devicelevel: '50',
              newdevicelevel: '20',
              rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
              os_ver: '12',
              OpenUDID: '0',
              OpenUDID2: '0',
              QIMEI36: '0',
              udid: '0',
              chid: '0',
              aid: '0',
              oaid: '0',
              taid: '0',
              tid: '0',
              wid: '0',
              uid: '0',
              sid: '0',
              modeSwitch: '6',
              teenMode: '0',
              ui_mode: '2',
              nettype: '1020',
              v4ip: '',
            },
            req: {
              module: 'music.search.SearchCgiService',
              method: 'DoSearchForQQMusicMobile',
              param: {
                search_type: searchType,
                searchid: Math.random().toString().slice(2),
                query: str,
                page_num: page,
                num_per_page: limit,
                highlight: 0,
                nqc_flag: 0,
                multi_zhida: 0,
                cat: 2,
                grp: 1,
                sin: 0,
                sem: 0,
              },
            },
          })
          const body = response?.body
          const req = body?.['music.search.SearchCgiService'] ?? body?.req
          const data = req?.data
          if (response.statusCode >= 200 && response.statusCode < 300 && body?.code == this.successCode && req?.code == this.successCode &&
            data?.body && data?.meta && (searchType !== 0 || Array.isArray(isDesktop ? data.body.song?.list : data.body.item_song))) return data
          failure = responseError(response)
        } catch (error) {
          failure = networkError(error)
        }
        const details = failure.searchDetails
        const delays = details.httpStatus == 200 && details.code == 0 && details.reqCode == 2001
          ? qqSearchRetryDelays
          : retryDelays
        const retry = failure.retryable && attempt + retryNum < delays.length && (!context || (attempt < 2 && context.attempts < 6))
        // Keep this small and free of keywords, signed URLs, cookies and response bodies.
        console.warn('[QQSearch]', JSON.stringify({ ...failure.searchDetails, attempt: attempt + 1, elapsedMs: Date.now() - started, retry }))
        if (!retry) throw failure
        await requestDelay(Math.max(delays[attempt + retryNum], failure.retryAfterMs || 0))
      }
    }
    return shareRequest(pendingSearches, key, run)
  },
  // randomInt(min, max) {
  //   return Math.floor(Math.random() * (max - min + 1)) + min
  // },
  // getSearchId() {
  //   const e = BigInt(this.randomInt(1, 20))
  //   const t = e * 18014398509481984n
  //   const n = BigInt(this.randomInt(0, 4194304)) * 4294967296n
  //   const a = BigInt(Date.now())
  //   const r = (a * 1000n) % (24n * 60n * 60n * 1000n)
  //   return String(t + n + r)
  // },
  handleResult(rawList) {
    // console.log(rawList)
    if (!rawList || !Array.isArray(rawList)) return []
    const list = []
    rawList.forEach(item => {
      if (!item.file?.media_mid) return

      let types = []
      let _types = {}
      const file = item.file
      if (file.size_128mp3 > 0) {
        let size = sizeFormate(file.size_128mp3)
        types.push({ type: '128k', size })
        _types['128k'] = {
          size,
        }
      }
      if (file.size_320mp3 > 0) {
        let size = sizeFormate(file.size_320mp3)
        types.push({ type: '320k', size })
        _types['320k'] = {
          size,
        }
      }
      if (file.size_flac > 0) {
        let size = sizeFormate(file.size_flac)
        types.push({ type: 'flac', size })
        _types.flac = {
          size,
        }
      }
      if (file.size_hires > 0) {
        let size = sizeFormate(file.size_hires)
        types.push({ type: 'flac24bit', size })
        _types.flac24bit = {
          size,
        }
      }
      // types.reverse()
      let albumId = ''
      let albumName = ''
      if (item.album) {
        albumName = item.album.name
        albumId = item.album.mid
      }
      list.push({
        singer: formatSingerName(item.singer, 'name'),
        // name: item.name + (item.title_extra ?? ''),
        name: item.title,
        albumName,
        albumId,
        source: 'tx',
        interval: formatPlayTime(item.interval),
        songId: item.id,
        songType: item.type,
        albumMid: item.album?.mid ?? '',
        strMediaMid: item.file.media_mid,
        songmid: item.mid,
        img: (albumId === '' || albumId === '空')
          ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
          : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
        types,
        _types,
        typeUrl: {},
      })
    })
    // console.log(list)
    return list
  },
  search: withSearchFallback(function(str, page, limit, context) { return this.searchPrimary(str, page, limit, true, context) }, [mobileSearch, smartboxSearch]),
  searchPrimary(str, page = 1, limit, isDesktop = true, context) {
    if (limit == null) limit = this.limit
    // http://newlyric.kuwo.cn/newlyric.lrc?62355680
    return this.musicSearch(str, page, limit, 0, 0, isDesktop, context).then(({ body, meta }) => {
      let list = this.handleResult(isDesktop ? body.song.list : body.item_song)

      this.total = isDesktop ? meta.sum : meta.estimate_sum
      this.page = page
      this.allPage = Math.ceil(this.total / limit)

      return Promise.resolve({
        list,
        allPage: this.allPage,
        limit,
        total: this.total,
        source: 'tx',
      })
    })
  },
}
