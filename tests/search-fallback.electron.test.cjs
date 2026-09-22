const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const crypto = require('node:crypto')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('production search renders all five fallback sources and pages Migu correctly', { timeout: 90000 }, async t => {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const host = req.headers.host
      const url = new URL(req.url, 'http://' + host)
      const call = { host, path: url.pathname, page: Number(url.searchParams.get('pageNo') || url.searchParams.get('page') || 1) }
      calls.push(call)
      let body
      let status = 200
      if (host === 'www.kuwo.cn') body = { HIT: '1', abslist: [{ MUSICRID: 'MUSIC_42', SONGNAME: 'fallback kw', ARTIST: 'artist', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M', DURATION: '12', ALBUMID: '7' }] }
      else if (host === 'msearch.kugou.com') body = { status: 1, errcode: 0, data: { total: 1, info: [{ audio_id: 43, hash: 'ABC123', filesize: 128, songname: '<em>fallback kg</em>', singername: 'artist', album_name: 'album', album_id: '8', duration: 12 }] } }
      else if (host === 'u.y.qq.com') {
        const payload = JSON.parse(Buffer.concat(chunks).toString())
        const request = payload['music.search.SearchCgiService']
        call.desktop = !!request
        const song = { id: 44, mid: 'qq-fixture', title: 'fallback tx', singer: [{ name: 'artist' }], album: { mid: 'album', name: 'album' }, file: { media_mid: 'media-fixture', size_128mp3: 128 }, interval: 12 }
        body = request ? { code: 0, 'music.search.SearchCgiService': { code: 0, data: { body: { song: { list: [song] } }, meta: { sum: 1 } } } } : { code: 0, req: { code: 2001 } }
      } else if (host === 'interface.music.163.com') {
        const params = new URLSearchParams(Buffer.concat(chunks).toString()).get('params')
        const decipher = crypto.createDecipheriv('aes-128-ecb', 'e82ckenh8dichen8', null)
        const plaintext = Buffer.concat([decipher.update(Buffer.from(params, 'hex')), decipher.final()]).toString()
        call.logicalPath = plaintext.split('-36cd479b6b5-')[0]
        if (call.logicalPath === '/api/cloudsearch/pc') body = { code: 200, result: { songs: [{ id: 45, name: 'fallback wy', ar: [{ name: 'artist' }], al: { id: 9, name: 'album' }, dt: 12000, privilege: { maxbr: 128000 }, l: { size: 128 } }], songCount: 1 } }
        else status = 503
      } else if (host === 'app.u.nf.migu.cn') {
        const offset = (call.page - 1) * 20
        body = Array.from({ length: Math.max(0, Math.min(20, 65 - offset)) }, (_, i) => ({ songId: String(offset + i + 1), copyrightId: 'copyright-' + (offset + i + 1), songName: 'fallback mg ' + (offset + i + 1), singerList: [{ name: 'artist' }], album: 'album', albumId: '10', audioFormats: [{ formatType: 'PQ', asize: 128 }], duration: 12 }))
      } else if (host === 'y.gtimg.cn') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
        res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>')
        return
      } else status = 503
      res.writeHead(status, { 'Content-Type': 'application/json' })
      const json = JSON.stringify(body ?? {})
      res.end(host === 'msearch.kugou.com' ? '<!--KG_TAG_RES_START-->' + json + '<!--KG_TAG_RES_END-->' : json)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture, stderr = ''
  try {
    fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
    fixture.app.process().stderr.on('data', data => { stderr = (stderr + data).slice(-5000) })
    const { page, errors, output } = fixture
    const stacks = []
    page.on('pageerror', error => { if (stacks.length < 4) stacks.push(error.stack) })
    page.setDefaultTimeout(15000)
    await page.evaluate(port => {
      const http = require('node:http'), https = require('node:https')
      const originalHttp = http.request, originalHttps = https.request
      const hosts = ['search.kuwo.cn', 'www.kuwo.cn', 'artistpicserver.kuwo.cn', 'songsearch.kugou.com', 'msearch.kugou.com', 'u.y.qq.com', 'y.gtimg.cn', 'interface.music.163.com', 'jadeite.migu.cn', 'pd.musicapp.migu.cn', 'app.u.nf.migu.cn', 'music.migu.cn', 'c.musicapp.migu.cn']
      const intercept = original => function(options, ...args) {
        const hostname = options.hostname ?? options.host
        if (!hosts.includes(hostname)) return original.call(this, options, ...args)
        return originalHttp.call(http, { ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, Host: hostname } }, ...args)
      }
      http.request = intercept(originalHttp)
      https.request = intercept(originalHttps)
      window.lxData.updateSetting({ 'list.loadingMode': 'progressive' })
      window.__fallbackList = () => window.__motionComponents().find(c => Array.isArray(c.props.list) && 'checkApiSource' in c.props)?.props.list
    }, server.address().port)
    const ids = {}
    for (const source of ['kw', 'kg', 'tx', 'wy', 'mg']) {
      await route(page, `/search?text=fallback&source=${source}&type=music`)
      await page.getByText(source === 'mg' ? 'fallback mg 1' : 'fallback ' + source, { exact: true }).first().waitFor()
      const list = await page.evaluate(() => window.__fallbackList())
      assert(list.length && list.every(song => song.source === source))
      assert(list.every(song => song.id && song.meta.songId != null))
      ids[source] = list.map(song => song.id)
    }
    assert.equal(ids.mg.length, 30)
    const pageTwoLabel = await page.evaluate(() => window.i18n.t('pagination__page', { num: 2 }))
    await page.getByRole('button', { name: pageTwoLabel, exact: true }).first().click()
    await page.getByText('fallback mg 31', { exact: true }).first().waitFor()
    const second = await page.evaluate(() => window.__fallbackList())
    assert.equal(second.length, 30)
    assert(!second.some(song => ids.mg.includes(song.id)))
    assert.equal(second[0].meta.songId, '31')
    assert.equal(second[0].meta.copyrightId, 'copyright-31')
    assert.equal(calls.filter(call => call.host === 'jadeite.migu.cn').length, 1, 'paging keeps the PC provider')
    await route(page, '/search?text=fallback&source=all&type=music')
    await page.waitForFunction(() => new Set((window.__fallbackList() ?? []).map(song => song.source)).size === 5)
    if (errors.length) t.diagnostic(JSON.stringify(stacks))
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'search-fallback.json'), JSON.stringify({ calls, ids }, null, 2))
    await page.screenshot({ path: path.join(output, 'search-fallback.png') })
    t.diagnostic('Five-platform fallback verification: ' + output)
  } catch (error) {
    t.diagnostic(JSON.stringify({ stderr, errors: fixture?.errors }))
    throw error
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
