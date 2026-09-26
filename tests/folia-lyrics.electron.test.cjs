const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, showDetail, settled } = require('./helpers/motion-fixture.cjs')
const { mockGitHub, openStore, label, install, uninstall, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

const modes = ['classic', 'fume', 'partita', 'tilt', 'cadenza', 'cappella', 'claddagh', 'diorama', 'monet', 'pendolo', 'sonnet', 'tempera', 'still']
const engineFor = async(page, surface) => {
  const element = await page.locator(`[data-folia-stage="${surface}"] iframe`).elementHandle()
  const frame = await element.contentFrame()
  await frame.waitForFunction(() => !!document.documentElement?.dataset.mode)
  return frame
}

test('Folia installs, renders every style, follows playback and restores preferences offline', { timeout: 120000 }, async t => {
  const launchOptions = { rendererPath: path.resolve('dist/index.html'), disableHardwareAcceleration: false, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  let fixture = await launch(launchOptions)
  const profilePath = fixture.output
  let { app, page } = fixture
  try {
    page.setDefaultTimeout(12000)
    await page.addInitScript(() => {
      const native = window.requestAnimationFrame.bind(window)
      window.__foliaNativeCallbacks = new Set()
      window.requestAnimationFrame = callback => {
        window.__foliaNativeCallbacks.add(callback)
        return native(callback)
      }
    })
    await page.evaluate(() => {
      window.__foliaAnalysers = []
      const create = AudioContext.prototype.createAnalyser
      AudioContext.prototype.createAnalyser = function() {
        const analyser = create.call(this)
        const disconnect = analyser.disconnect.bind(analyser)
        analyser.__disconnected = false
        analyser.disconnect = (...args) => { analyser.__disconnected = true; return disconnect(...args) }
        window.__foliaAnalysers.push(analyser)
        return analyser
      }
    })
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    const settings = page.locator('[data-plugin-id="folia-lyrics"]')
    await settings.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    let frame = await engineFor(page, 'preview')
    await frame.evaluate(() => {
      window.__stateMessages = []
      addEventListener('message', event => {
        if (event.data?.channel === 'lx-m:folia-lyrics' && ['state', 'config'].includes(event.data.type)) window.__stateMessages.push(event.data.type)
      })
    })
    await t.test('installation exposes all thirteen choices and enables the plugin', async() => {
      assert.equal(await page.locator('[data-folia-enabled]').isChecked(), true)
      assert.equal(await page.locator('[data-folia-mode] option').count(), modes.length)
      assert.equal(await frame.evaluate(() => typeof require), 'undefined', 'the render frame has no Node integration')
    })
    for (const mode of modes) {
      await t.test(`the ${mode} source renderer produces a preview without runtime errors`, async() => {
        await page.locator('[data-folia-mode]').selectOption(mode)
        await frame.waitForFunction(mode => document.documentElement.dataset.mode === mode, mode)
        await frame.waitForFunction(() => document.querySelector('#root canvas') || document.querySelector('#root')?.textContent.trim())
        assert.equal(await frame.locator('[data-folia-unavailable]').count(), 0, `${mode} should render with WebGL available`)
        if (['diorama', 'sonnet', 'tempera'].includes(mode)) await frame.locator('canvas').waitFor()
        await page.waitForTimeout(350)
        assert.equal(await page.locator('[data-folia-stage] [role="alert"]').count(), 0)
        assert.deepEqual(fixture.errors, [])
        await page.locator('[data-folia-stage="preview"]').screenshot({ path: path.join(profilePath, `folia-${mode}.png`) })
      })
    }
    await t.test('preview style changes reuse the song instead of resending all lyric lines', async() => {
      const messages = await frame.evaluate(() => window.__stateMessages)
      assert.equal(messages.filter(type => type === 'state').length, 0)
      assert.equal(messages.filter(type => type === 'config').length, modes.length - 1)
    })
    await t.test('Motion and canvas styles share one native frame clock, including on high refresh displays', async() => {
      assert.equal(await frame.evaluate(() => window.__foliaNativeCallbacks.size), 1, 'animation libraries must not retain a native RAF that bypasses the frame limit')
    })
    await t.test('Cadenza reuses unchanged text metrics and nodes while refreshing them when the font changes', async() => {
      await page.locator('[data-folia-mode]').selectOption('cadenza')
      await frame.waitForFunction(() => document.documentElement.dataset.mode === 'cadenza' && Number(document.documentElement.dataset.time) % 4 >= 1.8 && Number(document.documentElement.dataset.time) % 4 <= 2.1 && [...document.querySelectorAll('#root span')].some(span => span.style.zIndex === '1' && span.firstChild?.nodeType === Node.TEXT_NODE))
      await frame.evaluate(() => {
        window.__cadenzaMeasurements = 0
        const measure = CanvasRenderingContext2D.prototype.measureText
        CanvasRenderingContext2D.prototype.measureText = function(...args) { window.__cadenzaMeasurements++; return measure.apply(this, args) }
        window.__cadenzaBody = [...document.querySelectorAll('#root span')].find(span => span.style.zIndex === '1' && span.firstChild?.nodeType === Node.TEXT_NODE)
        window.__cadenzaText = window.__cadenzaBody.firstChild
      })
      await page.waitForTimeout(500)
      const measured = await frame.evaluate(() => ({ count: window.__cadenzaMeasurements, retainedText: window.__cadenzaText.isConnected && window.__cadenzaBody.firstChild === window.__cadenzaText }))
      assert(measured.count < 8, 'newly revealed words may be measured, but existing words must reuse their metrics')
      assert.equal(measured.retainedText, true)
      const originalFont = await page.evaluate(() => {
        const previous = window.lxData.appSetting['common.font']
        window.lxData.appSetting['common.font'] = 'serif'
        return previous
      })
      await frame.waitForFunction(before => window.__cadenzaMeasurements > before, measured.count)
      await frame.waitForFunction(() => [...document.querySelectorAll('#root [style]')].some(element => element.style.font.includes('serif')))
      await page.evaluate(font => { window.lxData.appSetting['common.font'] = font }, originalFont)
    })
    await page.locator('[data-folia-mode]').selectOption('classic')
    await page.evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#297c88"/></svg>'
      Object.assign(window.lxData.musicInfo, {
        id: 'folia-track', name: 'Folia fixture', singer: 'Fixture', album: 'Fixture', pic: 'data:image/svg+xml,' + encodeURIComponent(svg),
        lrc: '[00:00.000]第一行\n[00:00.800]第二行\n[00:01.500]第三行',
        lxlrc: '[00:00.000]<0,200>第<200,200>一<400,250>行\n[00:00.800]<0,200>第<200,200>二<400,250>行\n[00:01.500]<0,100>第<100,100>三<200,200>行',
        tlrc: '', rlrc: '',
      })
      window.lxData.appSetting['player.isPlayLxlrc'] = true
      window.app_event.lyricUpdated()
    })
    await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().muted = true })
    await startSilentAudio(page)
    await showDetail(page, true)
    await settled(page)
    frame = await engineFor(page, 'player')
    await t.test('the player uses the actual audio clock and freezes it on pause', async() => {
      await frame.waitForFunction(() => document.documentElement.dataset.playing === 'true')
      await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().pause())
      await frame.waitForFunction(() => document.documentElement.dataset.playing === 'false')
      const time = await frame.evaluate(() => document.documentElement.dataset.time)
      await page.waitForTimeout(180)
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.time), time)
      assert.equal(await page.locator('[data-player-detail] .lyric').count(), 0)
      await frame.waitForFunction(() => document.querySelector('#root')?.textContent.includes('第'))
    })
    await t.test('paused seeks within a line reuse its measured text layout', async() => {
      await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().currentTime = 0.2 })
      await frame.waitForFunction(() => document.documentElement.dataset.time === '0.200')
      await page.waitForTimeout(100)
      await frame.evaluate(() => {
        window.__textMeasurements = 0
        const measure = CanvasRenderingContext2D.prototype.measureText
        CanvasRenderingContext2D.prototype.measureText = function(...args) { window.__textMeasurements++; return measure.apply(this, args) }
      })
      for (const time of [0.3, 0.4, 0.5]) {
        await page.evaluate(time => { window.__lxPluginHost.player.getAudioElement().currentTime = time }, time)
        await frame.waitForFunction(time => document.documentElement.dataset.time === time, time.toFixed(3))
        await page.waitForTimeout(100)
      }
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.line), '0')
      assert.equal(await frame.evaluate(() => window.__textMeasurements), 0)
    })
    await t.test('seeking and lyric offsets synchronize while paused', async() => {
      await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().currentTime = 0.9 })
      await frame.waitForFunction(() => Number(document.documentElement.dataset.time) >= 0.9 && Number(document.documentElement.dataset.time) < 1.05)
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.line), '1')
      await page.evaluate(() => { window.__lxPluginHost.mainLyricState.lyric.tempOffset = -700 })
      await frame.waitForFunction(() => Number(document.documentElement.dataset.time) < 0.3)
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.line), '0')
    })
    await t.test('disabling and reenabling restores native lyrics without interrupting audio', async() => {
      const controls = await page.locator('[data-player-detail] [data-detail-part="controls"]').boundingBox()
      await page.mouse.move(controls.x + controls.width / 2, controls.y - 20)
      await page.locator('[data-folia-toggle]').click()
      await page.locator('[data-player-detail] .lyric').waitFor()
      assert.equal(await page.locator('[data-folia-stage="player"]').count(), 0)
      assert.equal(await page.locator('[data-folia-window-drag]').count(), 0)
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), true)
      assert.equal(await page.evaluate(() => window.__foliaAnalysers.length > 0 && window.__foliaAnalysers.every(node => node.__disconnected)), true)
      await page.locator('[data-folia-toggle]').click()
      frame = await engineFor(page, 'player')
      await page.locator('[data-folia-stage="player"] [data-folia-mode]').selectOption('fume')
      await frame.waitForFunction(() => document.documentElement.dataset.mode === 'fume')
      await frame.waitForFunction(() => {
        const canvas = document.querySelector('canvas')
        return canvas?.width && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)
      })
      const before = await frame.locator('canvas').evaluate(canvas => canvas.toDataURL())
      await page.evaluate(() => { window.__lxPluginHost.player.getAudioElement().currentTime = 1.15 })
      await frame.waitForFunction(() => Number(document.documentElement.dataset.time) > 0.44 && document.documentElement.dataset.line === '0')
      await frame.waitForFunction(before => document.querySelector('canvas').toDataURL() !== before, before)
      await frame.waitForFunction(() => {
        const canvas = document.querySelector('canvas')
        const pixels = canvas.getContext('2d').getImageData(canvas.width * 0.1, canvas.height * 0.2, canvas.width * 0.8, canvas.height * 0.6).data
        return pixels.some((value, index) => index % 4 === 3 && value > 127)
      })
      await page.waitForTimeout(400)
      const viewport = page.viewportSize() ?? await page.evaluate(() => ({ width: innerWidth }))
      const bounds = await page.locator('[data-folia-stage="player"] select, [data-folia-stage="player"] button').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
      assert.ok(bounds.every(right => right <= viewport.width), 'The Folia toolbar must fit inside the player')
      await page.screenshot({ path: path.join(profilePath, 'folia-player.png') })
    })
    await t.test('paused Fume redraws forward and backward across lyric lines', async() => {
      await page.evaluate(() => {
        window.__lxPluginHost.mainLyricState.lyric.tempOffset = 0
        window.__lxPluginHost.player.getAudioElement().currentTime = 0.2
      })
      await frame.waitForFunction(() => document.documentElement.dataset.time === '0.200')
      await page.waitForTimeout(80)
      let before = await frame.locator('canvas').evaluate(canvas => canvas.toDataURL())
      for (const [time, index] of [[0.9, 1], [1.7, 2], [0.2, 0]]) {
        await page.evaluate(time => { window.__lxPluginHost.player.getAudioElement().currentTime = time }, time)
        await frame.waitForFunction(({ time, index }) => document.documentElement.dataset.time === time && document.documentElement.dataset.line === String(index), { time: time.toFixed(3), index })
        await frame.waitForFunction(before => document.querySelector('canvas').toDataURL() !== before, before)
        await page.waitForTimeout(80)
        before = await frame.locator('canvas').evaluate(canvas => canvas.toDataURL())
      }
    })
    await t.test('track changes clear old lyrics and display plain LRC', async() => {
      await frame.evaluate(() => {
        addEventListener('message', event => {
          if (event.data?.channel === 'lx-m:folia-lyrics' && event.data.type === 'state') window.__receivedSong = event.data.data.song
        })
      })
      await page.evaluate(() => {
        Object.assign(window.lxData.musicInfo, { id: 'folia-empty', name: 'No lyrics', lrc: '', lxlrc: '', tlrc: '', rlrc: '' })
        window.app_event.lyricUpdated()
      })
      await frame.getByText('暂无歌词', { exact: true }).waitFor()
      assert.equal(await frame.getByText('第一行', { exact: true }).count(), 0)
      await page.evaluate(() => {
        Object.assign(window.lxData.musicInfo, { id: 'folia-plain', name: 'Plain LRC', lrc: '[00:00.000]普通歌词第一行\n[00:01.000]普通歌词第二行' })
        window.__lxPluginHost.mainLyricState.lyric.tempOffset = 0
        window.__lxPluginHost.player.getAudioElement().currentTime = 0.4
        window.app_event.lyricUpdated()
      })
      await frame.waitForFunction(() => window.__receivedSong?.id === 'folia-plain' && window.__receivedSong.lines[0]?.fullText === '普通歌词第一行')
      await frame.locator('canvas').waitFor()
      assert.equal(await frame.getByText('暂无歌词', { exact: true }).count(), 0)
      await frame.waitForFunction(() => document.documentElement.dataset.line === '0')
    })
    await t.test('the render frame forwards lyric seeks using the current offset', async() => {
      await page.evaluate(() => { window.__lxPluginHost.mainLyricState.lyric.tempOffset = 200 })
      const expected = await page.evaluate(() => 1.3 - (window.__lxPluginHost.mainLyricState.lyric.offset + 200) / 1000)
      await frame.evaluate(() => parent.postMessage({ channel: 'lx-m:folia-lyrics', type: 'seek', data: 1.3 }, '*'))
      await page.waitForFunction(expected => Math.abs(window.__lxPluginHost.player.getAudioElement().currentTime - expected) < 0.02, expected)
      await frame.waitForFunction(() => Number(document.documentElement.dataset.time) >= 1.3 && document.documentElement.dataset.line === '1')
    })
    await showDetail(page, false)
    await settled(page)
    await page.locator('[data-folia-enabled]').uncheck()
    assert.deepEqual(fixture.errors, [])
    await app.close()
    fixture = null
    fixture = await launch({ ...launchOptions, profilePath })
    ;({ app, page } = fixture)
    await mockGitHub(app, true)
    await openStore(page)
    await t.test('offline restart restores installation and chosen style', async() => {
      const card = page.locator('[data-plugin-id="folia-lyrics"]')
      await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
      const saved = JSON.parse(await fs.readFile(path.join(profilePath, 'portable/userData/LxDatas/plugins/preferences/folia-lyrics.json'), 'utf8'))
      assert.equal(saved.mode, 'fume')
      assert.equal(saved.enabled, false)
      assert.equal(await page.locator('[data-folia-enabled]').isChecked(), false)
      frame = await engineFor(page, 'preview')
      assert.equal(await frame.evaluate(() => document.documentElement.dataset.mode), 'fume')
    })
    await t.test('uninstall removes rendering code while retaining preferences', async() => {
      await uninstall(page, 'folia-lyrics')
      assert.equal(await page.locator('[data-folia-stage]').count(), 0)
      assert.equal(await page.locator('style[data-plugin="folia-lyrics"]').count(), 0)
      const directory = path.join(profilePath, 'portable/userData/LxDatas/plugins')
      assert.equal((await fs.readdir(directory)).some(name => name.startsWith('folia-lyrics-')), false)
      assert.ok(await fs.stat(path.join(directory, 'preferences/folia-lyrics.json')))
    })
    assert.deepEqual(fixture.errors, [])
    t.diagnostic('Folia screenshots: ' + profilePath)
  } finally {
    if (fixture) await fixture.app.close()
  }
})

test('unavailable WebGL explains the limitation and allows another style immediately', { timeout: 30000 }, async() => {
  const fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const { app, page } = fixture
  try {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
        return kind === 'webgl' || kind === 'webgl2' ? null : original.call(this, kind, ...args)
      }
    })
    await mockGitHub(app)
    await openStore(page)
    await install(page, 'folia-lyrics')
    await page.locator('[data-plugin-id="folia-lyrics"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).click()
    const frame = await engineFor(page, 'preview')
    for (const mode of ['diorama', 'sonnet', 'tempera']) {
      await page.locator('[data-folia-mode]').selectOption(mode)
      await frame.locator('[data-folia-unavailable]').waitFor()
    }
    await page.locator('[data-folia-mode]').selectOption('classic')
    await frame.waitForFunction(() => document.querySelector('#root')?.textContent.includes('晚'))
    assert.equal(await frame.locator('[data-folia-unavailable]').count(), 0)
    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
