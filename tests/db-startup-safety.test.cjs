const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createLoader = require('./helpers/load-typescript.cjs')

const withDataDir = callback => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-db-startup-'))
  try { callback(dir) } finally {
    for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name))
    fs.rmdirSync(dir)
  }
}

const loadDB = (failure = '') => {
  const opens = []
  const instances = []
  class FakeDatabase {
    constructor(filename, options) {
      opens.push({ filename, options })
      if (failure === 'open') throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
      this.closed = false
      this.inTransaction = false
      instances.push(this)
    }
    pragma() {}
    exec() {}
    prepare() { return { run() {} } }
    close() { this.closed = true }
  }
  const load = createLoader({
    'better-sqlite3': FakeDatabase,
    path,
    './migrate': { __esModule: true, default: () => {
      if (failure === 'migrate') throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' })
    } },
    './verifyDB': { __esModule: true, default: () => failure !== 'schema' },
    './statementCache': { cacheStatements() {} },
  })
  return { init: load('src/main/worker/dbService/db.ts').init, opens, instances }
}

for (const failure of ['open', 'migrate', 'schema']) {
  test('database startup preserves an existing file after ' + failure + ' failure', () => withDataDir(dir => {
    const filename = path.join(dir, 'lx.data.db')
    fs.writeFileSync(filename, 'original database bytes')
    const { init, opens, instances } = loadDB(failure)
    assert.throws(() => init(dir), { code: failure === 'schema' ? 'DB_SCHEMA_MISMATCH' : 'SQLITE_BUSY' })
    assert.equal(fs.readFileSync(filename, 'utf8'), 'original database bytes')
    assert.equal(opens.length, 1)
    assert.equal(opens[0].options.fileMustExist, true)
    assert(instances.every(instance => instance.closed))
  }))
}

test('database startup does not create an empty file when a backup remains', () => withDataDir(dir => {
  fs.writeFileSync(path.join(dir, 'lx.data.db.123.bak'), 'backup')
  const { init, opens } = loadDB()
  assert.throws(() => init(dir), { code: 'DB_RECOVERY_REQUIRED' })
  assert.equal(opens.length, 0)
  assert.equal(fs.existsSync(path.join(dir, 'lx.data.db')), false)
}))

test('database startup initializes a genuinely empty data directory', () => withDataDir(dir => {
  const { init, opens } = loadDB()
  assert.equal(init(dir), false)
  assert.equal(opens.length, 1)
  assert.equal(opens[0].options.fileMustExist, false)
}))
