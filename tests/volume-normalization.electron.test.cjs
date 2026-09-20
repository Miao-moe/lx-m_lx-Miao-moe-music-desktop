const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')
const { launch, route, settled, seedTrack } = require('./helpers/motion-fixture.cjs')

function wave(amplitude, frequency) {
  const rate = 48000, count = rate * 7
  const bytes = Buffer.alloc(44 + count * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * frequency / rate) * amplitude * 32767), 44 + i * 2)
  return bytes
}
const set = (page, values) => page.evaluate(async values => {
  await require('electron').ipcRenderer.invoke('common_set_app_setting', values)
  Object.assign(window.lxData.appSetting, values)
}, values)
const rms = page => page.evaluate(async() => {
  const { analyser, dispose } = window.__lxPluginHost.player.createAudioAnalyser()
  analyser.fftSize = 2048
  const buffer = new Float32Array(analyser.fftSize)
  let sum = 0, count = 0
  for (let frame = 0; frame < 12; frame++) {
    await new Promise(resolve => setTimeout(resolve, 20))
    analyser.getFloatTimeDomainData(buffer)
    for (const value of buffer) { sum += value * value; count++ }
  }
  dispose()
  return Math.sqrt(sum / count)
})

test('volume normalization works on real audio, settings, overlapping tracks and restart', { timeout: 100000 }, async t => {
  let fixture = await launch({ rendererPath: path.resolve('dist/index.html') })
  const profilePath = fixture.output
  let { page } = fixture
  const quietPath = path.join(profilePath, 'quiet.wav')
  const loudPath = path.join(profilePath, 'loud.wav')
  await fs.writeFile(quietPath, wave(0.1, 997))
  await fs.writeFile(loudPath, wave(0.8, 503))
  const urls = [quietPath, loudPath].map(file => pathToFileURL(file).href)
  const checkbox = () => page.locator('#setting_player_volume_normalization')
  const click = () => page.locator('label[for="setting_player_volume_normalization"]').click()
  const play = async url => {
    await page.evaluate(async url => {
      const player = window.__lxPluginHost.player
      player.setResource(url)
      player.setLoopPlay(true)
      await player.getAudioContext().resume()
      await player.getAudioElement().play()
    }, url)
  }
  try {
    page.setDefaultTimeout(8000)
    await seedTrack(page)
    await page.evaluate(() => {
      window.lxData.musicInfo.lrc = '[00:00.00]Volume normalization test\n[00:02.00]Audio signal'
      window.app_event.lyricUpdated()
      window.__normalization = { sources: [], nodes: [], reports: [], moduleRequests: 0, failures: 1 }
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
      const createSource = AudioContext.prototype.createMediaElementSource
      AudioContext.prototype.createMediaElementSource = function(element) {
        const node = createSource.call(this, element)
        window.__normalization.sources.push(element)
        return node
      }
      const worklet = window.__lxPluginHost.player.getAudioContext().audioWorklet
      const addModule = worklet.addModule.bind(worklet)
      worklet.addModule = function(...args) {
        window.__normalization.moduleRequests++
        if (window.__normalization.failures-- > 0) return Promise.reject(new Error('injected worklet load failure'))
        return addModule(...args)
      }
      const WorkletNode = window.AudioWorkletNode
      window.AudioWorkletNode = class extends WorkletNode {
        constructor(context, name, options) {
          super(context, name, options)
          if (name !== 'lx-volume-normalizer') return
          const index = window.__normalization.nodes.push(this) - 1
          this.port.addEventListener('message', event => { window.__normalization.reports[index] = event.data })
          this.port.start()
        }
      }
    })
    await set(page, { 'player.volume': 0.5, 'player.isMute': false, 'player.gaplessPlayback': false, 'player.volumeNormalization': false })
    await route(page, '/setting?name=SettingPlay')
    await settled(page)

    await t.test('the setting is searchable and a failed load falls back to audible unmodified playback', async() => {
      const searchName = await page.evaluate(() => window.i18n.t('setting__filter_placeholder'))
      const search = page.getByRole('textbox', { name: searchName, exact: true })
      await search.fill('音量均衡')
      await checkbox().waitFor({ state: 'attached' })
      await page.locator('label[for="setting_player_volume_normalization"]').waitFor()
      assert.equal(await checkbox().isChecked(), false)
      await click()
      await page.waitForFunction(() => window.__normalization.moduleRequests === 1 && !window.lxData.appSetting['player.volumeNormalization'])
      await play(urls[0])
      const original = await rms(page)
      assert.ok(Math.abs(original - 0.1 / Math.sqrt(2) * 0.5) < 0.004, `fallback RMS ${original}`)
      await search.fill('')
    })

    await t.test('retry loads the packaged worklet, reveals the description and narrows actual track levels', async() => {
      await click()
      await page.waitForFunction(() => window.__normalization.nodes.length === 2)
      await page.locator('[data-setting-reveal][data-setting-search-depends="setting_player_volume_normalization"]').waitFor()
      await page.waitForTimeout(5000)
      const quiet = await rms(page)
      await play(urls[1])
      await page.waitForTimeout(2500)
      const loud = await rms(page)
      const difference = Math.abs(20 * Math.log10(quiet / loud))
      assert.ok(difference < 1, `remaining real-audio difference ${difference.toFixed(3)} dB`)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.volume']), 0.5)
      assert.equal(await page.evaluate(() => window.__normalization.moduleRequests), 2, 'a failed module load must be retryable')
      t.diagnostic(`Real audio: 18 dB input difference reduced to ${difference.toFixed(2)} dB`)
      await page.locator('label[for="setting_player_volume_normalization"]').scrollIntoViewIfNeeded()
      await settled(page)
      await page.screenshot({ path: path.join(profilePath, 'volume-normalization-setting.png') })
    })

    await t.test('both overlap sources normalize before fading and retain user volume and mute controls', async() => {
      await page.evaluate(async url => {
        const player = window.__lxPluginHost.player
        const secondary = window.__normalization.sources.find(source => source !== player.getAudioElement())
        window.__secondaryNormalization = secondary
        secondary.src = url
        secondary.loop = true
        secondary.muted = false
        player.gaplessAudioOutput.setVolume(secondary, 0)
        await secondary.play()
      }, urls[0])
      await page.waitForTimeout(5000)
      const before = await page.evaluate(() => window.__normalization.reports.map(report => report.gainDb))
      await page.evaluate(() => {
        const player = window.__lxPluginHost.player
        player.gaplessAudioOutput.setVolume(player.getAudioElement(), 0.2)
        player.gaplessAudioOutput.setVolume(window.__secondaryNormalization, 0.8)
      })
      await set(page, { 'player.volume': 0.35 })
      await page.waitForTimeout(800)
      const after = await page.evaluate(() => ({
        gains: window.__normalization.reports.map(report => report.gainDb),
        sources: window.__normalization.sources.map(source => ({ nativeVolume: source.volume, fade: window.__lxPluginHost.player.gaplessAudioOutput.getVolume(source) })),
      }))
      assert.ok(Math.abs(after.gains[0] - before[0]) < 0.15)
      assert.ok(Math.abs(after.gains[1] - before[1]) < 0.15)
      assert.deepEqual(after.sources.map(value => value.nativeVolume), [1, 1])
      assert.deepEqual(after.sources.map(value => value.fade), [0.2, 0.8])
      await set(page, { 'player.isMute': true })
      await page.waitForTimeout(150)
      assert.ok(await rms(page) < 0.00001)
      await set(page, { 'player.isMute': false, 'player.volume': 0.5 })
      await page.evaluate(() => {
        window.__secondaryNormalization.pause()
        const player = window.__lxPluginHost.player
        player.gaplessAudioOutput.setVolume(window.__secondaryNormalization, 0)
        player.gaplessAudioOutput.setVolume(player.getAudioElement(), 1)
      })
      await play(urls[0])
      const handoffRms = await rms(page)
      assert.ok(Math.abs(handoffRms - 10 ** (-18 / 20) * 0.5) < 0.006, `handoff must reuse the incoming track level; RMS ${handoffRms}`)
      await play(urls[1])
    })

    await t.test('disabling and re-enabling do not stack nodes or change the selected output device', async() => {
      await click()
      await page.waitForFunction(() => window.__normalization.nodes.every(node => node.parameters.get('enabled').value === 0))
      await page.waitForTimeout(250)
      assert.ok(Math.abs(await rms(page) - 0.8 / Math.sqrt(2) * 0.5) < 0.012)
      const sink = await page.evaluate(() => window.__lxPluginHost.player.getAudioContext().sinkId)
      await page.evaluate(async() => window.__lxPluginHost.player.setMediaDeviceId('default'))
      await click()
      await page.waitForFunction(() => window.__normalization.nodes.every(node => node.parameters.get('enabled').value === 1))
      assert.equal(await page.evaluate(() => window.__normalization.nodes.length), 2)
      assert.equal(await page.evaluate(() => window.__lxPluginHost.player.getAudioContext().sinkId), sink)
      await set(page, { 'player.soundEffect.biquadFilter.hz1000': 3 })
      await page.waitForTimeout(400)
      assert.ok(await rms(page) > 0.01, 'normalization and built-in EQ must coexist')
      await set(page, { 'player.soundEffect.biquadFilter.hz1000': 0 })
    })

    assert.deepEqual(fixture.errors, [])
    await fixture.app.close()
    fixture = await launch({ profilePath, rendererPath: path.resolve('dist/index.html') })
    page = fixture.page
    await t.test('the enabled preference survives restart', async() => {
      await route(page, '/setting?name=SettingPlay')
      await checkbox().waitFor({ state: 'attached' })
      assert.equal(await checkbox().isChecked(), true)
      assert.equal(await page.evaluate(() => window.lxData.appSetting['player.volumeNormalization']), true)
    })
    assert.deepEqual(fixture.errors, [])
    t.diagnostic(`Settings screenshot: ${path.join(profilePath, 'volume-normalization-setting.png')}`)
  } finally { await fixture.app.close() }
})
