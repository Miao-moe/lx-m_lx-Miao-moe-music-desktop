const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')
for (const mode of ['migration', 'indexes', 'history', 'catalog']) {
  test('E01/E02/E06/E12–E17: SQLite ' + mode, () => {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'helpers/library-database-fixture.cjs'), mode], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 20000 })
    assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message ?? ''))
    assert(result.stdout.includes('PASS ' + mode))
  })
}
