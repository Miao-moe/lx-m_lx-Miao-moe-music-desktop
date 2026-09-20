const assert = require('node:assert/strict')
const { test } = require('node:test')
const { launch } = require('./helpers/motion-fixture.cjs')

test('legacy audio output keeps processing, serializes switches and recovers from device failures', { timeout: 30000 }, async() => {
  const fixture = await launch()
  const { page, app } = fixture
  try {
    await page.evaluate(async() => {
      const player = window.__lxPluginHost.player
      player.setVolume(0)
      Object.defineProperty(AudioContext.prototype, 'setSinkId', { configurable: true, value: undefined })
      const original = HTMLMediaElement.prototype.setSinkId
      window.__legacyOutput = { elements: new Set(), calls: [], edges: 0 }
      HTMLMediaElement.prototype.setSinkId = async function(id) {
        if (this.srcObject instanceof MediaStream) {
          window.__legacyOutput.elements.add(this)
          window.__legacyOutput.calls.push(id)
          if (id === 'missing-device') throw Error('Device unavailable')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        return original.call(this, 'default')
      }
      for (const method of ['connect', 'disconnect']) {
        const original = AudioNode.prototype[method]
        AudioNode.prototype[method] = function(target, ...args) {
          const result = original.call(this, target, ...args)
          if (target instanceof MediaStreamAudioDestinationNode) window.__legacyOutput.edges += method === 'connect' ? 1 : -1
          return result
        }
      }
      await player.getAudioContext().resume()
      await player.setVolumeNormalization(true)
      await player.setMediaDeviceId('headphones')
      player.setMaxOutputChannelCount(true)
      player.setMaxOutputChannelCount(false)
    })
    const snapshot = () => page.evaluate(() => ({
      bridges: window.__legacyOutput.elements.size,
      playing: [...window.__legacyOutput.elements].some(element => !element.paused),
      calls: window.__legacyOutput.calls,
      edges: window.__legacyOutput.edges,
      supported: window.__lxPluginHost.player.supportsAudioOutputDeviceSelection(),
    }))
    assert.deepEqual(await snapshot(), { bridges: 1, playing: true, calls: ['headphones'], edges: 1, supported: true })
    await assert.rejects(page.evaluate(() => window.__lxPluginHost.player.setMediaDeviceId('missing-device')), /Device unavailable/)
    assert.equal((await snapshot()).edges, 1, 'a rejected device leaves the previous output connected')
    await page.evaluate(async() => {
      const player = window.__lxPluginHost.player
      await Promise.all([player.setMediaDeviceId('speakers'), player.setMediaDeviceId('headphones')])
      await player.setVolumeNormalization(false)
      await player.setVolumeNormalization(true)
    })
    assert.equal((await snapshot()).bridges, 1)
    assert.equal((await snapshot()).edges, 1)
    assert.deepEqual((await snapshot()).calls, ['headphones', 'missing-device', 'speakers', 'headphones'])
    await page.evaluate(() => window.__lxPluginHost.player.setMediaDeviceId('default'))
    assert.equal((await snapshot()).edges, 0)
    assert.equal((await snapshot()).playing, false)
    assert.deepEqual(fixture.errors, [])
  } finally { await app.close() }
})
