const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { dependencyFiles } = require('../build-config/plugins/developer-kit/dependencies.cjs')

test('Folia browser dependencies include installed packages that share Node builtin names', async t => {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'lx-plugin-dependencies-'))
  t.after(async() => {
    assert(path.resolve(directory).startsWith(path.join(temporaryRoot, 'lx-plugin-dependencies-')))
    await fs.rm(directory, { recursive: true, force: true })
  })
  await fs.writeFile(path.join(directory, 'package.json'), '{}')
  for (const [name, info] of [
    ['browser-engine', { version: '1.0.0', dependencies: { buffer: '^6.0.3' } }],
    ['buffer', { version: '6.0.3', exports: { '.': './index.js' }, dependencies: { 'base64-js': '^1.5.1' } }],
    ['base64-js', { version: '1.5.1' }],
  ]) {
    const target = path.join(directory, 'node_modules', name)
    await fs.mkdir(target, { recursive: true })
    await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name, license: 'MIT', ...info }))
    await fs.writeFile(path.join(target, 'index.js'), "throw Error('Dependency code must not execute when packaging')")
  }
  const files = new Map()
  await dependencyFiles({ 'browser-engine': '1.0.0' }, directory, 'vendor/engine/', files)
  for (const name of ['browser-engine', 'buffer', 'base64-js']) assert(files.has(`vendor/engine/${name}/index.js`))
  assert.equal(JSON.parse(files.get('vendor/engine/dependencies.json')).buffer.version, '6.0.3')
  await assert.rejects(dependencyFiles({ buffer: '5.0.0' }, directory, 'vendor/engine/', new Map()), /Pin buffer to its installed version 6.0.3/)
})
