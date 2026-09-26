const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')
const load = () => loader({ path: require('node:path'), os: require('node:os'), crypto: require('node:crypto'), 'electron-log/node': { hooks: [], error() {} } })
const sensitive = load()('src/common/sensitive.ts')

test('H02: URLs, nested settings, serialized settings, error causes and paired values are redacted', () => {
  const secret = 'very-private-value'
  const cases = [
    { 'cookie.wy': secret, nested: { password: secret }, safe: 'visible' },
    JSON.stringify({ 'cookie.wy': secret, 'sync.webdav.password': secret, 'sync.webdav.url': secret }),
    'request https://user:' + secret + '@example.com/path?auth=' + secret,
    Object.assign(Error('Authorization: Bearer ' + secret), { cause: { token: secret } }),
  ]
  for (const value of cases) assert(!JSON.stringify(sensitive.redactSensitive(value)).includes(secret))
  assert(!JSON.stringify(sensitive.redactArguments(['Cookie:', secret])).includes(secret))
  assert.equal(sensitive.redactSensitive({ safe: 'visible' }).safe, 'visible')
})

function storage(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-security-vault-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const key = crypto.randomBytes(32)
  let available = true; let failing = false
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]) },
    decryptString(value) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString() },
  }
  const api = loader({
    electron: { safeStorage },
    'node:fs/promises': {
      ...fs.promises,
      rename: async(from, to) => {
        if (failing && to.endsWith('config_v2.json')) throw Object.assign(Error('disk full'), { code: 'ENOSPC' })
        return fs.promises.rename(from, to)
      },
    },
  })('src/main/utils/credentials.ts')
  return { root, ...api, unavailable: () => { available = false }, fail: () => { failing = true } }
}

test('H01: legacy credentials migrate to encrypted storage and are merged only in memory', async t => {
  const api = storage(t); const filename = path.join(api.root, 'config_v2.json')
  const value = { setting: { 'cookie.wy': 'session-secret', 'sync.webdav.password': 'dav-secret', 'player.volume': 0.4 } }
  fs.writeFileSync(filename, JSON.stringify(value))
  await api.writeProtectedConfig(filename, value)
  for (const file of fs.readdirSync(api.root)) {
    const text = fs.readFileSync(path.join(api.root, file), 'utf8')
    assert(!text.includes('session-secret') && !text.includes('dav-secret'))
  }
  const stored = JSON.parse(fs.readFileSync(filename))
  assert(!Object.hasOwn(stored.setting, 'cookie.wy'))
  assert.equal(api.readProtectedConfig(filename, stored).setting['cookie.wy'], 'session-secret')
  api.unavailable()
  assert.throws(() => api.readProtectedConfig(filename, stored), { code: 'CREDENTIAL_STORAGE_UNAVAILABLE' })
})

test('H01: failed config commit restores the previous vault and preserves the original config', async t => {
  const api = storage(t); const filename = path.join(api.root, 'config_v2.json')
  const original = { setting: { 'cookie.wy': 'old-secret', 'player.volume': 0.4 } }
  await api.writeProtectedConfig(filename, original)
  const disk = fs.readFileSync(filename, 'utf8'); const vault = fs.readFileSync(path.join(api.root, 'credentials.json'), 'utf8')
  api.fail()
  await assert.rejects(api.writeProtectedConfig(filename, { setting: { 'cookie.wy': 'new-secret', 'player.volume': 0.8 } }), { code: 'ENOSPC' })
  assert.equal(fs.readFileSync(filename, 'utf8'), disk)
  assert.equal(fs.readFileSync(path.join(api.root, 'credentials.json'), 'utf8'), vault)
  assert(!fs.existsSync(path.join(api.root, 'credentials-commit.json')))
})

test('H01: exports and legacy imports exclude account secrets and keep ordinary preferences', () => {
  const { validateBackupSettings } = load()('src/common/backup.ts')
  const value = validateBackupSettings({ 'cookie.wy': 'secret', 'sync.webdav.password': 'secret', 'player.volume': 0.4 })
  assert(!Object.hasOwn(value, 'cookie.wy'))
  assert(!Object.hasOwn(value, 'sync.webdav.password'))
  assert.equal(value['player.volume'], 0.4)
})

test('H06: unregistered windows, subframes, navigation and cross-role calls are denied', () => {
  const policy = load()('src/main/utils/ipcPolicy.ts')
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///app/index.html' } })
  const event = { sender, senderFrame: sender.mainFrame }
  assert.throws(() => policy.assertIpcRequest(event, 'common_get_app_setting'), { code: 'IPC_SENDER_DENIED' })
  policy.registerIpcWindow(sender, 'main', sender.mainFrame.url)
  policy.assertIpcRequest(event, 'common_get_app_setting')
  assert.throws(() => policy.assertIpcRequest({ ...event, senderFrame: { url: sender.mainFrame.url } }, 'common_get_app_setting'), { code: 'IPC_SENDER_DENIED' })
  sender.mainFrame.url = 'https://evil.example/'
  assert.throws(() => policy.assertIpcRequest(event, 'common_get_app_setting'), { code: 'IPC_SENDER_DENIED' })
  sender.mainFrame.url = 'file:///app/lyric.html'
  policy.registerIpcWindow(sender, 'lyric', sender.mainFrame.url)
  policy.assertIpcRequest(event, 'common_get_app_setting')
  assert.throws(() => policy.assertIpcRequest(event, 'optional_plugins:install', 'test-plugin'), { code: 'IPC_CHANNEL_DENIED' })
  assert.throws(() => policy.assertIpcRequest(event, 'winLyric_set_config', { 'cookie.wy': 'secret' }), { code: 'IPC_ARGUMENT_INVALID' })
  policy.registerIpcWindow(sender, 'userApi', sender.mainFrame.url)
  assert.throws(() => policy.assertIpcRequest(event, 'common_get_app_setting'), { code: 'IPC_CHANNEL_DENIED' })
})

test('H06: malformed, oversized, cyclic and prototype-bearing payloads are rejected', () => {
  const policy = load()('src/main/utils/ipcPolicy.ts')
  for (const value of [JSON.parse('{"__proto__":{"admin":true}}'), { value: NaN }, { value: () => {} }]) assert.throws(() => policy.validateIpcValue(value), { code: 'IPC_ARGUMENT_INVALID' })
  const cycle = {}; cycle.self = cycle
  assert.throws(() => policy.validateIpcValue(cycle), { code: 'IPC_ARGUMENT_INVALID' })
  assert.throws(() => policy.validateIpcValue(Buffer.alloc(65 * 1024 * 1024)), { code: 'IPC_PAYLOAD_LIMIT' })
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///app/index.html' } })
  policy.registerIpcWindow(sender, 'main', sender.mainFrame.url)
  const event = { sender, senderFrame: sender.mainFrame }
  assert.throws(() => policy.assertIpcRequest(event, 'common_set_app_setting', { 'cookie.wy': 1 }), { code: 'IPC_ARGUMENT_INVALID' })
  policy.assertIpcRequest(event, 'player_list_music_clear', ['default', 'love'])
  assert.throws(() => policy.assertIpcRequest(event, 'player_list_music_clear', 'love'), { code: 'IPC_ARGUMENT_INVALID' })
  policy.assertIpcRequest(event, 'winMain_open_api_action', { action: 'enable', data: { enable: false } })
  assert.throws(() => policy.assertIpcRequest(event, 'winMain_open_api_action', { action: 'enable', data: { enable: true, bindLan: false, port: '3000junk' } }), { code: 'IPC_ARGUMENT_INVALID' })
  assert.throws(() => policy.assertIpcRequest(event, 'winMain_open_api_action', { action: 'enable', data: { enable: true } }), { code: 'IPC_ARGUMENT_INVALID' })
})

test('H09: source manifests require version pinning, digest and explicit public origins', () => {
  const api = load()('src/main/modules/sourcePlugins/network.ts')
  const manifest = { id: 'test-source', version: '1.0.0', url: 'https://example.com/v1/plugin.js', sha256: 'a'.repeat(64), allowedOrigins: ['https://api.example.com'] }
  assert.deepEqual(api.validateSourceManifest(manifest), manifest)
  for (const patch of [{ sha256: '' }, { version: 'latest' }, { url: 'http://example.com/source.js' }, { allowedOrigins: ['https://api.example.com/any'] }, { url: 'https://localhost/source.js' }, { url: 'https://127.0.0.1/source.js' }]) assert.throws(() => api.validateSourceManifest({ ...manifest, ...patch }))
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1', 'fe80::1', '::ffff:127.0.0.1']) assert(!api.publicAddress(address), address)
  assert(api.publicAddress('8.8.8.8'))
  assert.throws(() => api.sourceRequest(manifest.url, { method: 'DELETE' }), { code: 'SOURCE_METHOD_DENIED' })
  assert.throws(() => api.sourceRequest(manifest.url, { headers: { Cookie: 'secret' } }), { code: 'SOURCE_HEADER_DENIED' })
})
