import Database from 'better-sqlite3'
import path from 'path'
import { readdirSync, statSync } from 'node:fs'
import tables, { DB_VERSION } from './tables'
import verifyDB from './verifyDB'
import migrateData from './migrate'
import { cacheStatements } from './statementCache'

let db: Database.Database


const initTables = (db: Database.Database) => {
  db.exec(`
    ${Array.from(tables.values()).join('\n')}
    INSERT INTO "main"."db_info" ("field_name", "field_value") VALUES ('version', '${DB_VERSION}');
  `)
}


const startupError = (code: string, message: string) => Object.assign(new Error(message), { code })

// A failed open or migration must never turn an existing database into a new one.
const databaseExists = (lxDataPath: string, databasePath: string) => {
  try {
    if (!statSync(databasePath).isFile()) throw startupError('DB_INVALID_FILE', '数据库路径不是文件。')
    return true
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    if (readdirSync(lxDataPath).some(name => /^lx\.data\.db(?:[-.]|$)/.test(name))) {
      throw startupError('DB_RECOVERY_REQUIRED', '主数据库缺失，但发现日志或备份文件；请先恢复数据库。')
    }
    return false
  }
}

// 打开、初始化数据库
export const init = (lxDataPath: string): boolean => {
  const databasePath = path.join(lxDataPath, 'lx.data.db')
  const nativeBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  const dbFileExists = databaseExists(lxDataPath, databasePath)
  let opened: Database.Database | undefined

  try {
    opened = new Database(databasePath, { fileMustExist: dbFileExists, nativeBinding })
    const activeDB = opened
    if (!dbFileExists) initTables(activeDB)
    activeDB.pragma('journal_mode = WAL')

    if (dbFileExists) {
      migrateData(activeDB)
      activeDB.prepare('DELETE FROM "main"."music_url" WHERE "expire_time"<=?').run(Date.now())
      // https://www.sqlite.org/pragma.html#pragma_optimize
      activeDB.exec('PRAGMA optimize;')
    }
    if (!verifyDB(activeDB)) throw startupError('DB_SCHEMA_MISMATCH', '数据库表结构与当前版本不兼容；原文件已保留。')

    // https://www.sqlite.org/lang_vacuum.html
    const cleanTrash = () => {
      // A manual restore may await file writes inside a DB transaction.
      if (!activeDB.inTransaction) activeDB.prepare('DELETE FROM list_trash WHERE expires_at <= ?').run(Date.now())
    }
    cacheStatements(activeDB)
    cleanTrash()
    db = activeDB
    const trashTimer = setInterval(cleanTrash, 60 * 60 * 1000)
    trashTimer.unref()

    process.on('exit', () => {
      clearInterval(trashTimer)
      activeDB.close()
    })
    console.log('db inited')
    return dbFileExists
  } catch (error) {
    try { opened?.close() } catch (closeError) { console.error('Failed to close database after initialization error', closeError) }
    throw error
  }
}

// 获取数据库实例
export const getDB = (): Database.Database => db
