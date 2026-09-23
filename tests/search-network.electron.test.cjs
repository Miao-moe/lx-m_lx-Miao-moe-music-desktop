const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route } = require('./helpers/motion-fixture.cjs')

test('B12/B13/B21/B22: production search streams, retries one platform, merges songs and cancels on exit', { timeout: 60000 }, async t => {
  const calls = []
  let qqFails = true, miguClosed = false, fixture, stderr = ''
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const host = req.headers.host
      calls.push(host)
      let body = {}, status = 200
      if (host === 'jadeite.migu.cn') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{')
        res.on('close', () => { miguClosed = true })
        return
      }
      if (host === 'search.kuwo.cn') body = { TOTAL: 3, abslist: ['Same song', 'Same song (Live)', 'Other song'].map((name, i) => ({ MUSICRID: 'MUSIC_' + (i + 1), SONGNAME: name, ARTIST: 'Fixture', DURATION: '180', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:4M' })) }
      else if (host === 'songsearch.kugou.com') body = { error_code: 0, data: { total: 1, lists: [{ Audioid: 4, FileHash: 'HASH', FileSize: 128, SongName: 'Same song', Singers: [{ name: 'Fixture' }], Duration: 180 }] } }
      else if (host === 'u.y.qq.com') {
        if (qqFails) status = 403
        else {
          const payload = JSON.parse(Buffer.concat(chunks).toString())
          const key = payload.req ? 'req' : 'music.search.SearchCgiService'
          const song = { id: 5, mid: 'qq-song', title: 'Recovered song', singer: [{ name: 'Fixture' }], album: { mid: '', name: '' }, file: { media_mid: 'media', size_128mp3: 128 }, interval: 180 }
          body = { code: 0, [key]: { code: 0, data: { body: { song: { list: [song] } }, meta: { sum: 1 } } } }
        }
      } else if (host === 'interface.music.163.com') body = { code: 200, data: { resources: [], totalCount: 0 } }
      else status = 404
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
    fixture.app.process().stderr.on('data', data => { stderr = (stderr + data).slice(-5000) })
    const { page, errors, output } = fixture
    page.setDefaultTimeout(7000)
    await page.evaluate(port => {
      const http = require('node:http'), https = require('node:https')
      const originalHttp = http.request, originalHttps = https.request
      const hosts = ['search.kuwo.cn', 'songsearch.kugou.com', 'u.y.qq.com', 'c.y.qq.com', 'interface.music.163.com', 'jadeite.migu.cn', 'artistpicserver.kuwo.cn', 'gateway.kugou.com']
      const intercept = original => function(options, ...args) {
        const hostname = options.hostname ?? options.host
        if (!hosts.includes(hostname)) return original.call(this, options, ...args)
        return originalHttp.call(http, { ...options, protocol: 'http:', hostname: '127.0.0.1', host: '127.0.0.1', port, agent: undefined, headers: { ...options.headers, Host: hostname } }, ...args)
      }
      http.request = intercept(originalHttp)
      https.request = intercept(originalHttps)
      window.lxData.updateSetting({ 'list.loadingMode': 'together' })
      window.__searchView = () => window.__motionComponents().find(component => Array.isArray(component.props.list) && 'checkApiSource' in component.props)?.props
    }, server.address().port)
    await route(page, '/search?text=network-fixture&source=all&type=music')
    const rows = page.locator('#view .list-item')
    await page.waitForFunction(() => window.__searchView()?.list.length === 4)
    await rows.first().waitFor({ state: 'visible', timeout: 2000 })
    assert.equal(await rows.first().isVisible(), true, 'fast rows appear even when the general setting waits for all')
    await page.locator('[data-retry-source="tx"]').waitFor()
    const failedPlatform = page.locator('[data-search-platform="tx"]')
    assert.match(await failedPlatform.locator('[data-search-failed]').innerText(), /加载失败|loading failed/i)
    assert.doesNotMatch(await failedPlatform.innerText(), /403|原因|Reason/)
    assert.equal(await failedPlatform.getAttribute('title'), null)
    await page.screenshot({ path: path.join(output, 'network-search-error.png') })
    assert.match(await page.locator('[data-search-platform="mg"]').innerText(), /加载|Loading/)
    const before = [...calls]
    qqFails = false
    await page.locator('[data-retry-source="tx"]').click()
    await page.getByText('Recovered song', { exact: true }).first().waitFor()
    assert.equal(calls.filter(host => host === 'u.y.qq.com').length, 2)
    for (const host of ['search.kuwo.cn', 'songsearch.kugou.com', 'interface.music.163.com', 'jadeite.migu.cn']) {
      assert.equal(calls.filter(item => item === host).length, before.filter(item => item === host).length, host + ' must not be retried')
    }
    await page.locator('label[for="search-merge-songs"]').click()
    await page.waitForFunction(() => window.__searchView().list.length === 4 && Object.values(window.__searchView().sourceLabels).some(label => label.includes(' / ')))
    const mergedBadge = rows.filter({ hasText: 'Same song' }).filter({ hasNotText: 'Live' }).getByText('kw / kg', { exact: true })
    await mergedBadge.waitFor()
    for (const visible of [true, false]) {
      await page.evaluate(visible => window.lxData.updateSetting({ 'list.actionButtonsVisible': visible }), visible)
      await mergedBadge.waitFor()
    }
    assert.equal(await page.locator('[data-search-filters] [role="combobox"]').count(), 0)
    assert.equal(await page.getByText('筛选当前页', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Same song (Live)', { exact: true }).count(), 1)
    await page.screenshot({ path: path.join(output, 'network-search.png') })
    const bounds = await page.locator('[data-search-filters]').boundingBox()
    assert(bounds && bounds.height < 100, 'filter bar remains compact')
    await route(page, '/list')
    await new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (miguClosed) { clearInterval(timer); resolve() }
        else if (Date.now() - started > 2000) { clearInterval(timer); reject(Error('stalled Migu body was not cancelled on exit')) }
      }, 20)
    })
    assert.deepEqual(errors, [])
    await fs.writeFile(path.join(output, 'network-search.json'), JSON.stringify({ calls, miguClosed, errors }, null, 2))
    t.diagnostic('Production network/search verification: ' + output)
  } catch (error) {
    t.diagnostic(JSON.stringify({ calls, stderr, errors: fixture?.errors, state: await fixture?.page.evaluate(() => ({ view: window.__searchView?.()?.listInfo, text: document.querySelector('#view')?.innerText })).catch(() => null) }))
    throw error
  } finally {
    if (fixture) await fixture.app.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
