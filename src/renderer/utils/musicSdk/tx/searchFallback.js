import { randomBytes, randomInt } from 'node:crypto'
import { httpFetch } from '../../request'
import { assertSearch, readSearchBody, searchResult } from '../searchFallback'
import { signRequest } from './utils'
import { getMusicInfos } from './musicInfo'

export const buildDesktopSearchRequest = (str, page, limit, searchType = 0) => ({
  comm: {
    _channelid: '0',
    _os_version: '6.2.9200-2',
    ct: '19',
    cv: '2151',
    guid: '1F70E520B2EAA7D25E11760783C53CA9',
    patch: '118',
    psrf_access_token_expiresAt: 0,
    psrf_qqaccess_token: '',
    psrf_qqopenid: '',
    psrf_qqunionid: '',
    tmeAppID: 'qqmusic',
    tmeLoginType: 0,
    uin: '0',
    wid: '7223299733393904640',
  },
  'music.search.SearchCgiService': {
    module: 'music.search.SearchCgiService',
    method: 'DoSearchForQQMusicDesktop',
    param: {
      grp: 1,
      num_per_page: limit,
      page_num: page,
      query: str,
      remoteplace: 'txt.newclient.top',
      search_type: searchType,
      searchid: randomBytes(16).toString('hex').toUpperCase() + String(randomInt(100000)).padStart(5, '0'),
    },
  },
})

export async function desktopSearch(str, page, limit) {
  const body = readSearchBody(await signRequest(buildDesktopSearchRequest(str, page, limit)))
  const result = body?.['music.search.SearchCgiService'] ?? body?.req
  assertSearch(body?.code == 0 && result?.code == 0 && Array.isArray(result?.data?.body?.song?.list))
  return searchResult('tx', this.handleResult(result.data.body.song.list), result.data.meta?.sum, page, limit)
}

export function mobileSearch(str, page, limit, context) {
  return this.searchPrimary(str, page, limit, false, context)
}

export async function smartboxSearch(str, page, limit) {
  // Suggestions have no paging or complete total. Never repeat page one's songs.
  if (page > 1) return searchResult('tx', [], 0, page, limit, { limited: true })
  const params = new URLSearchParams({ format: 'json', key: str, inCharset: 'utf8', outCharset: 'utf-8', platform: 'yqq' })
  const body = readSearchBody(await httpFetch(`https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg?${params}`, {
    headers: { Referer: 'https://y.qq.com/' },
  }).promise)
  assertSearch(body?.code == 0 && Array.isArray(body?.data?.song?.itemlist))
  const mids = [...new Set(body.data.song.itemlist.map(item => item.mid).filter(mid => typeof mid == 'string' && mid))].slice(0, Math.min(limit, 10))
  const list = await getMusicInfos(mids)
  assertSearch(!mids.length || list.length)
  return searchResult('tx', list, list.length, page, limit, { limited: true })
}
