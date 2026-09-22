import { getCookie, getCookieValue } from '../cookieManager'
import { CookieLoginError, fetchResponse, getKugouAuth, getRemotePlaylists, requestKugou, wyEapiRequest } from '../cookiePlaylistApi'
import { updateSetting } from '../ipc'
import { queuePlatformRequest } from '../syncQueue'
import { WritebackError, type LocalPlaylist, type RemoteSession, type Snapshot, type Track, type WritebackSource } from './types'

// Protocol references: NeteaseCloudMusicApiEnhanced/api-enhanced,
// L-1124/QQMusicApi, MakcRe/KuGouMusicApi, Domdkw/miguMusic-api-enhanced.
const unsupported = async(): Promise<void> => { throw new WritebackError('unsupported') }
const numberId = (value: unknown) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new WritebackError('identity')
  const text = String(value ?? '')
  if (!/^\d+$/.test(text)) throw new WritebackError('identity')
  return text
}
const safeNumber = (value: unknown) => {
  const num = Number(numberId(value))
  if (!Number.isSafeInteger(num)) throw new WritebackError('identity')
  return num
}
const complete = (tracks: Track[], total: unknown) => {
  if (!Number.isSafeInteger(Number(total)) || Number(total) < 0 || tracks.length !== Number(total) ||
    tracks.some(track => !track.key) || new Set(tracks.map(track => track.key)).size !== tracks.length) throw new WritebackError('incomplete')
  return tracks
}

export const openRemotePlaylist = async(local: LocalPlaylist): Promise<RemoteSession> => {
  const source: WritebackSource = local.source
  const id = numberId(local.remoteId)
  let cookie = getCookie(source)
  if (!cookie.trim()) throw new WritebackError('login')
  let guard = () => {}
  const assertActive = () => {
    guard()
    if (getCookie(source) !== cookie) throw new WritebackError('login')
  }
  const request = async(url: string, options: Record<string, any> = {}) => {
    assertActive()
    return queuePlatformRequest(source, async() => { assertActive(); return fetchResponse(url, { ...options, timeout: 15000 }) })
  }
  const batches = async<T>(items: T[], action: (batch: T[]) => Promise<void>, size = 100) => {
    for (let offset = 0; offset < items.length; offset += size) {
      assertActive()
      await action(items.slice(offset, offset + size))
    }
  }
  const common = { assertActive, setGuard: (check: () => void) => { guard = check }, rename: unsupported, order: unsupported }

  if (source === 'wy') {
    if (!getCookieValue(cookie, 'MUSIC_U')) throw new WritebackError('login')
    const wy = async(api: string, params: Record<string, unknown>) => {
      assertActive()
      try {
        const body = await queuePlatformRequest(source, async() => { assertActive(); return wyEapiRequest(cookie, api, params) })
        assertActive()
        return body
      } catch (error) {
        if (error instanceof CookieLoginError) throw new WritebackError('login')
        throw error
      }
    }
    const account = await wy('/api/nuser/account/get', {})
    const ownerId = String(account?.account?.id ?? account?.profile?.userId ?? '')
    if (!ownerId) throw new WritebackError('login')
    let capabilities = { rename: false, order: false }
    const read = async(): Promise<Snapshot> => {
      const body = await wy('/api/v3/playlist/detail', { id, n: 0, s: 0 })
      const playlist = body?.playlist
      if (String(playlist?.creator?.userId) !== ownerId) throw new WritebackError('owner')
      // The special "liked songs" list uses a separate API. Only ordinary owned lists qualify.
      if (playlist.specialType !== 0) throw new WritebackError('unsupported')
      capabilities = { rename: true, order: true }
      if (!Array.isArray(playlist.trackIds)) throw new WritebackError('incomplete')
      const tracks = playlist.trackIds.map((item: any) => ({ key: numberId(item.id), songId: numberId(item.id) }))
      return { name: String(playlist.name), tracks: complete(tracks, playlist.trackCount) }
    }
    await read()
    const write = async(path: string, data: Record<string, unknown>) => {
      await wy(`/api${path}`, data)
    }
    const manipulate = async(op: string, tracks: Track[]) => {
      const ids = tracks.map(track => numberId(track.key))
      await batches(ids, async batch => write('/playlist/manipulate/tracks', { op, pid: id, trackIds: JSON.stringify(batch), imme: 'true' }))
    }
    return {
      ...common,
      ownerId,
      capabilities,
      read,
      add: async tracks => manipulate('add', tracks),
      remove: async tracks => manipulate('del', tracks),
      rename: async name => write('/playlist/update/name', { id, name }),
      order: async keys => write('/playlist/manipulate/tracks', { pid: id, op: 'update', trackIds: JSON.stringify(keys.map(numberId)) }),
    }
  }

  if (source === 'tx') {
    const ownerId = (getCookieValue(cookie, 'uin') ?? getCookieValue(cookie, 'wxuin') ?? '').match(/\d+/)?.[0]
    const key = getCookieValue(cookie, 'qqmusic_key')
    if (!ownerId || !key) throw new WritebackError('login')
    // This endpoint is specifically the current user's created lists, excluding subscriptions.
    const own = await queuePlatformRequest(source, async() => getRemotePlaylists('tx', cookie))
    if (!own.some(playlist => playlist.id === id)) throw new WritebackError('owner')
    let gtk = 5381
    for (const ch of key) gtk += (gtk << 5) + ch.charCodeAt(0)
    gtk &= 0x7fffffff
    const cgi = async(module: string, method: string, param: Record<string, unknown>) => {
      const { body } = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        method: 'post',
        headers: { Cookie: cookie, Referer: 'https://y.qq.com/', Origin: 'https://y.qq.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comm: { ct: 24, cv: 4747474, uin: ownerId, authst: key, g_tk: gtk, g_tk_new_20200303: gtk, format: 'json', platform: 'yqq.json', tmeLoginType: key.startsWith('W_X') ? 1 : 2 },
          req: { module, method, param },
        }),
      })
      if (body?.code !== 0 || body?.req?.code !== 0 || !body.req.data) throw new WritebackError('failed')
      return body.req.data
    }
    let dirId: number | undefined
    const read = async(): Promise<Snapshot> => {
      const tracks: Track[] = []
      let name = ''
      let total: number | undefined
      for (let page = 0; page < 1000; page++) {
        const data = await cgi('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
          disstid: safeNumber(id), dirid: dirId ?? 0, song_begin: tracks.length, song_num: 1000, tag: true, userinfo: true, orderlist: true, onlysonglist: false,
        })
        if (!Array.isArray(data.songlist)) throw new WritebackError('incomplete')
        const info = data.dirinfo
        if (info) {
          // Reads within a session are serialized by the writeback engine.
          // eslint-disable-next-line require-atomic-updates
          dirId = safeNumber(info.dirid ?? info.dirId)
          name = String(info.title ?? info.dirName ?? info.name ?? '')
        }
        if (total !== undefined && total !== Number(data.total_song_num)) throw new WritebackError('incomplete')
        total = Number(data.total_song_num)
        for (const song of data.songlist) tracks.push({ key: String(song.mid ?? song.songmid ?? ''), songId: numberId(song.id ?? song.songid), songType: safeNumber(song.type ?? song.songtype ?? 0) })
        if (!data.hasmore || !data.songlist.length) break
      }
      if (dirId === undefined || !name) throw new WritebackError('incomplete')
      return { name, tracks: complete(tracks, total) }
    }
    await read()
    const write = async(method: string, tracks: Track[]) => {
      const songs = tracks.map(track => ({ songId: safeNumber(track.songId), songType: safeNumber(track.songType ?? 0) }))
      await batches(songs, async batch => {
        const data = await cgi('music.musicasset.PlaylistDetailWrite', method, { dirId, tid: safeNumber(id), bFmtUtf8: true, v_songInfo: batch })
        if (data.retCode !== 0) throw new WritebackError('failed')
      })
    }
    return { ...common, ownerId, capabilities: { rename: false, order: false }, read, add: async tracks => write('AddSonglist', tracks), remove: async tracks => write('DelSonglist', tracks) }
  }

  if (source === 'kg') {
    const auth = getKugouAuth(cookie)
    const own = await queuePlatformRequest(source, async() => getRemotePlaylists('kg', cookie))
    if (!own.some(playlist => playlist.id === id)) throw new WritebackError('owner')
    const name = own.find(playlist => playlist.id === id)!.name
    const kg = async(path: string, data: Record<string, unknown>, extra: Record<string, string | number> = {}) => {
      assertActive()
      return queuePlatformRequest(source, async() => { assertActive(); return requestKugou(path, 'cloudlist.service.kugou.com', { ...data, userid: auth.userid, token: auth.token }, auth, extra) })
    }
    const read = async(): Promise<Snapshot> => {
      const tracks: Track[] = []
      let total: number | undefined
      for (let page = 1; page <= 1000; page++) {
        const data = await kg('/v4/get_list_all_file', { listid: id, page, pagesize: 100, area_code: 1, allplatform: 1, type: 0 })
        if (!Array.isArray(data?.info)) throw new WritebackError('incomplete')
        if (total !== undefined && total !== Number(data.count)) throw new WritebackError('incomplete')
        total = Number(data.count)
        for (const song of data.info) {
          const hash = String(song.hash ?? song.FileHash ?? '').toLowerCase()
          if (!/^[a-f0-9]{32}$/.test(hash)) throw new WritebackError('identity')
          tracks.push({ key: hash, hash, fileId: numberId(song.fileid), name: song.name ?? song.filename })
        }
        if (!data.info.length || tracks.length >= total) break
      }
      return { name, tracks: complete(tracks, total) }
    }
    return {
      ...common,
      ownerId: auth.userid,
      capabilities: { rename: false, order: false },
      read,
      add: async tracks => {
        const resources = tracks.map(track => {
          if (!track.hash || !/^[a-f0-9]{32}$/i.test(track.hash) || !track.name) throw new WritebackError('identity')
          // LX's audio_id is not a mixsongid. The API accepts name/hash with optional album information.
          return { number: 1, name: track.name, hash: track.hash, size: 0, sort: 0, timelen: 0, bitrate: 0, album_id: safeNumber(track.albumId ?? 0), mixsongid: 0 }
        })
        await batches(resources, async batch => {
          await kg('/cloudlist.service/v6/add_song', { listid: id, list_ver: 0, type: 0, slow_upload: 1, scene: 'false;null', data: batch }, { last_time: Math.floor(Date.now() / 1000), last_area: 'gztx' })
        })
      },
      remove: async tracks => {
        const resources = tracks.map(track => ({ fileid: safeNumber(track.fileId) }))
        await batches(resources, async batch => { await kg('/v4/delete_songs', { listid: id, list_ver: 0, type: 0, data: batch }) })
      },
    }
  }

  let pacmtoken = getCookieValue(cookie, 'pacmtoken') ?? getCookieValue(cookie, 'mg_auth_pacmtoken')
  const ownerId = getCookieValue(cookie, 'mg_auth_uid') ?? getCookieValue(cookie, 'USER_ID')
  if (!pacmtoken || !ownerId) throw new WritebackError('login')
  const mg = async(path: string, data?: Record<string, unknown>) => {
    const response = await request(`https://app.c.nf.migu.cn${path}`, {
      method: data ? 'post' : 'get',
      headers: { Cookie: `pacmtoken=${pacmtoken}`, Referer: 'https://music.migu.cn/', 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
    assertActive()
    const setCookies = response.headers?.['set-cookie'] ?? []
    const nextToken = (Array.isArray(setCookies) ? setCookies : [setCookies]).map((item: string) => /(?:^|;\s*)pacmtoken=([^;]+)/.exec(item)?.[1]).find(Boolean)
    if (nextToken && nextToken !== pacmtoken) {
      pacmtoken = nextToken
      cookie = cookie.split(';').map(item => item.trim()).filter(item => !/^(pacmtoken|mg_auth_pacmtoken)=/.test(item)).concat(`pacmtoken=${nextToken}`, `mg_auth_pacmtoken=${nextToken}`).join('; ')
      await updateSetting({ 'cookie.mg': cookie })
    }
    if (String(response.body?.code) !== '000000') throw new WritebackError('failed')
    return response.body
  }
  const home = await mg('/pc/user/home-page/v2.0')
  const playlists = home?.data?.myCreatedMusicLists?.createdMusicLists
  if (!Array.isArray(playlists) || !playlists.some((playlist: any) => String(playlist.musicListId ?? playlist.id) === id)) throw new WritebackError('owner')
  const read = async(): Promise<Snapshot> => {
    const home = await mg('/pc/user/home-page/v2.0')
    const playlist = home?.data?.myCreatedMusicLists?.createdMusicLists?.find((item: any) => String(item.musicListId ?? item.id) === id)
    if (!playlist) throw new WritebackError('owner')
    const tracks: Track[] = []
    let total: number | undefined
    for (let page = 1; page <= 1000; page++) {
      const body = await mg(`/MIGUM3.0/resource/playlist/song/v2.0?pageNo=${page}&pageSize=100&playlistId=${id}`)
      const data = body.data
      if (!Array.isArray(data?.songList)) throw new WritebackError('incomplete')
      if (total !== undefined && total !== Number(data.totalCount)) throw new WritebackError('incomplete')
      total = Number(data.totalCount)
      for (const song of data.songList) tracks.push({ key: numberId(song.songId), songId: numberId(song.songId), contentId: numberId(song.contentId), copyrightId: song.copyrightId })
      if (!data.songList.length || tracks.length >= total) break
    }
    return { name: String(playlist.title ?? playlist.name), tracks: complete(tracks, total) }
  }
  return {
    ...common,
    ownerId,
    capabilities: { rename: true, order: false },
    read,
    add: async tracks => {
      const contentIds: string[] = []
      for (const track of tracks) {
        if (track.contentId) contentIds.push(numberId(track.contentId))
        else {
          if (!track.copyrightId) throw new WritebackError('identity')
          const body = await mg(`/MIGUM2.0/v1.0/content/resourceinfo.do?resourceType=2&copyrightId=${encodeURIComponent(track.copyrightId)}`)
          const song = body.resource?.find((item: any) => String(item.songId) === track.key && item.copyrightId === track.copyrightId)
          contentIds.push(numberId(song?.contentId))
        }
      }
      await batches(contentIds, async batch => { await mg('/pc/user/api/add-music-list-song/v1.0', { id, contentIds: batch }) })
    },
    remove: async tracks => {
      const contentIds = tracks.map(track => numberId(track.contentId))
      await batches(contentIds, async batch => { await mg('/pc/user/h5-import-musiclist/v1.0', { id, channel: '23', songflag: '2', contentId: batch[0] }) }, 1)
    },
    rename: async title => { await mg('/pc/user/h5-import-musiclist/v1.0', { id, title, channel: '23', songflag: '0' }) },
  }
}
