const path = require('node:path')
const { route, settled } = require('./motion-fixture.cjs')

const catalogRoot = path.resolve(__dirname, '../../plugins/store')
const mockGitHub = async(app, offline = false) => {
  await app.evaluate(({ session, net }, { catalogRoot, offline }) => {
    const fs = process.mainModule.require('node:fs')
    const path = process.mainModule.require('node:path')
    global.__pluginOffline = offline
    global.__pluginRequests = []
    global.__pluginCatalogOverride = null
    global.__pluginPackageOverrides = {}
    const root = 'https://raw.githubusercontent.com/Miao-moe/lx-m_lx-Miao-moe-music-desktop/master/plugins/store/'
    session.fromPartition('persist:win-main').protocol.handle('https', request => {
      if (!request.url.startsWith(root)) return net.fetch(request, { bypassCustomProtocolHandlers: true })
      global.__pluginRequests.push(request.url)
      if (global.__pluginOffline) return new Response('Unavailable', { status: 503 })
      const relative = decodeURIComponent(request.url.slice(root.length))
      if (relative === 'catalog.json' && global.__pluginCatalogOverride) return new Response(JSON.stringify(global.__pluginCatalogOverride), { headers: { 'content-type': 'application/json' } })
      if (global.__pluginPackageOverrides[relative]) return new Response(Buffer.from(global.__pluginPackageOverrides[relative], 'base64'), { headers: { 'content-type': 'application/octet-stream' } })
      const filename = path.resolve(catalogRoot, relative)
      if (!filename.startsWith(catalogRoot + path.sep)) return new Response('', { status: 400 })
      return new Response(fs.readFileSync(filename), { headers: { 'content-type': relative.endsWith('.json') ? 'application/json' : 'application/octet-stream' } })
    })
  }, { catalogRoot, offline })
}
const openStore = async page => {
  await route(page, '/setting?name=SettingPluginStore')
  await settled(page)
  await page.locator('#plugin_store').waitFor()
}
const label = (page, key) => page.evaluate(key => window.i18n.t(key), key)
const install = async(page, id) => {
  const card = page.locator(`[data-plugin-id="${id}"]`)
  const button = card.getByRole('button', { name: await label(page, 'setting__plugins_install'), exact: true })
  await page.waitForFunction(id => {
    const card = document.querySelector(`[data-plugin-id="${id}"]`)
    return card && [...card.querySelectorAll('button')].some(button => !button.disabled)
  }, id)
  await button.click()
  await card.getByRole('button', { name: await label(page, 'setting__plugins_settings'), exact: true }).waitFor({ timeout: 180000 })
}
const uninstall = async(page, id) => {
  const card = page.locator(`[data-plugin-id="${id}"]`)
  await card.getByRole('button', { name: await label(page, 'setting__plugins_uninstall'), exact: true }).click()
  await card.getByRole('button', { name: await label(page, 'setting__plugins_install'), exact: true }).waitFor()
}
const startSilentAudio = async page => {
  const sampleRate = 44100
  const count = sampleRate * 2
  const bytes = Buffer.alloc(44 + count * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 1000 / sampleRate) * 8000), 44 + i * 2)
  await page.evaluate(async source => {
    const player = window.__lxPluginHost.player
    player.setResource(source)
    player.setLoopPlay(true)
    await player.getAudioContext().resume()
    await player.getAudioElement().play()
  }, 'data:audio/wav;base64,' + bytes.toString('base64'))
}

module.exports = { catalogRoot, mockGitHub, openStore, label, install, uninstall, startSilentAudio }
