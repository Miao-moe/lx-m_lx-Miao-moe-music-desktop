const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('QQ search retries the official interface, falls back to mobile, and recovers after a failed manual retry', { timeout: 90000 }, async t => {
  const requests = []
  let permitRetry = false
  const song = {
    id: 123456, mid: 'qq-search-fixture', title: 'Talullah', name: 'Talullah', type: 0, interval: 360,
    singer: [{ id: 1, mid: 'fixture-singer', name: 'Jamiroquai' }], album: { mid: 'fixture-album', name: 'Dynamite' },
    file: { media_mid: 'fixture-media', size_128mp3: 1024, size_320mp3: 0, size_flac: 0, size_hires: 0 },
  }
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      if (req.headers.host === 'c.y.qq.com') {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end('{}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#297c88"/></svg>')
      return
    }
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString())
      const request = payload.req ?? payload['music.search.SearchCgiService']
      const desktop = request.method === 'DoSearchForQQMusicDesktop'
      const query = request.param.query
      requests.push({ query, desktop, time: Date.now() })
      const attempt = requests.filter(request => request.query === query).length
      const failed = query === 'qq-permanent-error' ? !permitRetry : query === 'qq-mobile-fallback' ? desktop : attempt < 3
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const songs = failed ? [] : [song]
      res.end(JSON.stringify({ code: 0, [desktop ? 'music.search.SearchCgiService' : 'req']: { code: failed ? 2001 : 0, data: { body: desktop ? { song: { list: songs } } : { item_song: songs }, meta: { [desktop ? 'sum' : 'estimate_sum']: failed ? 0 : 1 } } } }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let fixture
  try {
    fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
    const { page, errors, output } = fixture
    page.setDefaultTimeout(15000)
    await page.evaluate(port => {
      const https = require('node:https')
      const http = require('node:http')
      const original = https.request
      https.request = function(options, ...args) {
        const hostname = options.hostname ?? options.host
        if (!['u.y.qq.com', 'y.gtimg.cn', 'c.y.qq.com'].includes(hostname)) return original.call(this, options, ...args)
        return http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, Host: hostname } }, ...args)
      }
      window.lxData.updateSetting({ 'list.loadingMode': 'progressive' })
    }, server.address().port)
    await page.evaluate(await fs.readFile('doc/qq-search-diagnostics.js', 'utf8'))
    await route(page, '/search?text=Talullah%20Jamiroquai&source=tx&type=music')
    await page.getByText('Talullah', { exact: true }).first().waitFor()
    const recovered = requests.filter(item => item.query === 'Talullah Jamiroquai')
    assert.equal(recovered.length, 3)
    assert.ok(recovered[1].time - recovered[0].time >= 600, 'QQ retries must be spaced out')
    assert(recovered.every(item => item.desktop), 'successful official retries must not use a fallback')
    await route(page, '/search?text=qq-mobile-fallback&source=tx&type=music')
    await page.getByText('Talullah', { exact: true }).first().waitFor()
    const fallback = requests.filter(item => item.query === 'qq-mobile-fallback')
    assert.equal(fallback.length, 4)
    assert(fallback.slice(0, 3).every(item => item.desktop))
    assert.equal(fallback[3].desktop, false)
    await route(page, '/search?text=qq-permanent-error&source=tx&type=music')
    const reload = await page.evaluate(() => window.i18n.t('reload'))
    const retry = page.getByRole('button', { name: reload, exact: true })
    await retry.waitFor()
    assert.equal(requests.filter(item => item.query === 'qq-permanent-error').length, 6)
    assert.deepEqual(errors, [])
    permitRetry = true
    await retry.click()
    await page.getByText('Talullah', { exact: true }).first().waitFor()
    assert.equal(requests.filter(item => item.query === 'qq-permanent-error').length, 7)
    const captured = JSON.parse(await page.evaluate(() => window.__lxQqSearchCapture.export()))
    assert.equal(captured.records.length, 14)
    assert.ok(captured.records.some(item => item.reqCode === 2001))
    assert.ok(captured.records.some(item => item.reqCode === 0 && item.songCount === 1))
    assert(!JSON.stringify(captured).includes('Talullah'))
    await page.evaluate(() => window.__lxQqSearchCapture.stop())
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'qq-search.json'), JSON.stringify(captured, null, 2))
    await page.screenshot({ path: path.join(output, 'qq-search-recovered.png') })
    t.diagnostic('QQ search verification: ' + output)
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
