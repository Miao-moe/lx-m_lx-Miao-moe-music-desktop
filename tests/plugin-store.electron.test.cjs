const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { test } = require('node:test')
const { launch, route, settled, seedTrack, showDetail } = require('./helpers/motion-fixture.cjs')

const { mockGitHub, openStore, label, install, uninstall, startSilentAudio } = require('./helpers/plugin-fixture.cjs')

test('GitHub plugins load independently, release audio resources, and survive offline restart', { timeout: 120000 }, async() => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  const pluginErrors = []
  const capturePluginErrors = page => page.on('console', message => {
    if (message.type() === 'error' && /Plugin .*failed|Sound effect .*failed/.test(message.text())) pluginErrors.push(message.text())
  })
  try {
    let { app, page } = fixture
    capturePluginErrors(page)
    page.setDefaultTimeout(12000)
    await mockGitHub(app)
    await page.evaluate(() => {
      window.__pluginAudio = { filters: [], analysers: [], worklets: [] }
      const connect = AudioNode.prototype.connect
      AudioNode.prototype.connect = function(target, ...args) {
        if (target instanceof AudioDestinationNode) {
          const silence = this.context.createGain()
          silence.gain.value = 0
          connect.call(silence, target)
          return connect.call(this, silence, ...args)
        }
        return connect.call(this, target, ...args)
      }
      for (const [method, collection] of [['createBiquadFilter', 'filters'], ['createAnalyser', 'analysers']]) {
        const original = AudioContext.prototype[method]
        AudioContext.prototype[method] = function(...args) {
          const node = original.apply(this, args)
          const disconnect = node.disconnect.bind(node)
          node.__disconnected = false
          node.disconnect = (...args) => { node.__disconnected = true; return disconnect(...args) }
          window.__pluginAudio[collection].push(node)
          return node
        }
      }
      const Worklet = window.AudioWorkletNode
      window.AudioWorkletNode = class extends Worklet {
        constructor(...args) { super(...args); window.__pluginAudio.worklets.push(this) }
      }
    })
    assert.equal(await page.evaluate(() => window.__lxPluginHost.player.hasInitedAdvancedAudioFeatures()), false)
    await openStore(page)
    await install(page, 'audio-visualizer')
    assert.equal(await page.evaluate(() => window.__pluginAudio.filters.length), 0, 'The visualizer must not create sound effect nodes')
    await page.evaluate(() => window.lxData.updateSetting({ 'player.soundEffect.biquadFilter.hz1000': 6 }))
    await page.waitForFunction(() => window.__pluginAudio.filters.length === 10)
    assert.equal(await page.evaluate(() => window.__pluginAudio.filters[5].gain.value), 6)
    await seedTrack(page)
    await showDetail(page, true)
    await settled(page)
    await page.locator('[data-sound-effect-button]').click()
    await page.locator('[data-plugin-sound-dialog]').waitFor()
    for (const [width, height] of [[828, 540], [1366, 768], [3840, 2160]]) {
      await page.setViewportSize({ width, height })
      await settled(page)
      const bounds = await page.locator('[data-plugin-sound-dialog] input, [data-plugin-sound-dialog] button').evaluateAll(elements => elements.map(element => {
        const { left, right, width } = element.getBoundingClientRect()
        return { left, right, width }
      }).filter(rect => rect.width > 0))
      for (const rect of bounds) assert.ok(rect.left >= 0 && rect.right <= width + 1, `Plugin UI outside ${width}px viewport: ${JSON.stringify(rect)}`)
      if (width === 828) await page.screenshot({ path: path.join(profilePath, 'plugin-store-small.png') })
    }
    await page.setViewportSize({ width: 1114, height: 718 })
    await page.screenshot({ path: path.join(profilePath, 'plugin-store.png') })
    await page.locator('[data-plugin-sound-dialog]').locator('..').getByRole('button', { name: await label(page, 'close'), exact: true }).click()
    const dataRoot = await app.evaluate(() => global.lxDataPath)
    const registryBefore = JSON.parse(await fs.readFile(path.join(dataRoot, 'plugins/installed.json'), 'utf8'))
    assert.deepEqual(Object.keys(registryBefore), ['audio-visualizer'])
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.lrc = '[00:00.00]Plugin audio check\n[00:01.00]Offline test signal'
      window.app_event.lyricUpdated()
    })
    await showDetail(page, true)
    await settled(page)
    await page.locator('[data-player-detail]').getByRole('button', { name: await label(page, 'player__sound_effect'), exact: true }).click()
    const soundDialog = page.locator('[data-plugin-sound-dialog]')
    await soundDialog.waitFor()
    await soundDialog.locator('..').getByRole('button', { name: await label(page, 'close'), exact: true }).click()
    await soundDialog.waitFor({ state: 'hidden' })
    await page.evaluate(() => window.lxData.updateSetting({ 'player.audioVisualization': true, 'desktopLyric.audioVisualization': true, 'desktopLyric.enable': true }))
    await page.locator('[data-plugin-visualizer="main"]').waitFor()
    const desktop = app.windows().find(window => window.url().includes('lyric.html')) ?? await app.waitForEvent('window', { predicate: window => window.url().includes('lyric.html') })
    await desktop.locator('[data-plugin-visualizer="desktop"]').waitFor({ timeout: 20000 })
    await startSilentAudio(page)
    await page.waitForFunction(() => {
      const analyser = window.__pluginAudio.analysers[0]
      if (!analyser) return false
      const values = new Uint8Array(analyser.frequencyBinCount)
      analyser.getByteFrequencyData(values)
      return values.some(value => value > 0)
    })
    await desktop.waitForFunction(() => {
      const canvas = document.querySelector('[data-plugin-visualizer="desktop"] canvas')
      return canvas?.width && canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(value => value > 0)
    })
    await page.evaluate(() => window.lxData.updateSetting({ 'player.soundEffect.convolution.fileName': 'filter-telephone.wav', 'player.soundEffect.pitchShifter.playbackRate': 1.25 }))
    await page.waitForFunction(() => window.__pluginAudio.worklets.length === 1)
    await page.evaluate(() => { window.__motionDetail().isShowPlayerDetail = false })
    await openStore(page)
    await page.evaluate(() => window.lxData.updateSetting({ 'player.soundEffect.biquadFilter.hz1000': 0, 'player.soundEffect.convolution.fileName': '', 'player.soundEffect.pitchShifter.playbackRate': 1 }))
    await page.waitForFunction(() => window.__pluginAudio.filters.every(filter => filter.__disconnected))
    assert.equal(await page.evaluate(() => window.__pluginAudio.filters.every(filter => filter.__disconnected)), true)
    assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioElement().paused), false, 'Disabling effects must not pause playback')
    assert.equal(await page.locator('style[data-plugin="sound-effects"]').count(), 0)
    assert.equal(await desktop.locator('[data-plugin-visualizer="desktop"]').count(), 1, 'The other plugin stays active')
    await page.evaluate(() => window.lxData.updateSetting({ 'player.soundEffect.biquadFilter.hz1000': 6, 'player.soundEffect.convolution.fileName': 'filter-telephone.wav', 'player.soundEffect.pitchShifter.playbackRate': 1.25 }))
    await page.waitForFunction(() => window.__pluginAudio.worklets.length === 2)
    assert.equal(await page.evaluate(() => window.__pluginAudio.filters.length), 20, 'Re-enabling creates a fresh effects graph')
    assert.equal(await page.evaluate(() => window.__pluginAudio.filters[15].gain.value), 6)
    await uninstall(page, 'audio-visualizer')
    await desktop.locator('[data-plugin-visualizer="desktop"]').waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__pluginAudio.analysers.every(analyser => analyser.__disconnected)), true)
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.soundEffect.biquadFilter.hz1000']), 6)
    await install(page, 'audio-visualizer')
    await page.evaluate(() => {
      window.__lxPluginHost.player.setStop()
      window.lxData.updateSetting({ 'desktopLyric.enable': false })
    })
    await route(page, '/search')
    assert.deepEqual(fixture.errors, [])
    assert.deepEqual(pluginErrors, [])
    await app.close()
    fixture = await launch({ rendererPath: path.resolve('dist/index.html'), profilePath })
    ;({ app, page } = fixture)
    capturePluginErrors(page)
    page.setDefaultTimeout(12000)
    await mockGitHub(app, true)
    await openStore(page)
    await page.getByRole('button', { name: await label(page, 'setting__plugins_refresh'), exact: true }).click()
    await page.getByText(await label(page, 'setting__plugins_catalog_error'), { exact: true }).waitFor()
    await page.locator('[data-plugin-id="audio-visualizer"]').getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).waitFor()
    assert.equal(await page.locator('[data-plugin-id="sound-effects"]').getByRole('button', { name: await label(page, 'setting__plugins_uninstall'), exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => window.lxData.appSetting['player.soundEffect.biquadFilter.hz1000']), 6)
    const registryAfter = JSON.parse(await fs.readFile(path.join(dataRoot, 'plugins/installed.json'), 'utf8'))
    assert.deepEqual(Object.keys(registryAfter), ['audio-visualizer'])
    assert.deepEqual(fixture.errors, [])
    assert.deepEqual(pluginErrors, [])
    console.log('Plugin store verification profile:', profilePath)
  } catch (error) {
    console.error('Plugin store failure profile:', profilePath)
    console.error('Plugin cards:', await fixture.page.locator('[data-plugin-id]').allTextContents().catch(() => []))
    console.error('Renderer errors:', fixture.errors)
    console.error('Plugin errors:', pluginErrors)
    await fixture.page.screenshot({ path: path.join(profilePath, 'plugin-store-failure.png') }).catch(() => {})
    throw error
  } finally {
    await fixture.app.close()
  }
})
