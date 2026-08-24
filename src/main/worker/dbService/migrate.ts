import type Database from 'better-sqlite3'
import tables, { DB_VERSION } from './tables'

// const migrateV1 = (db: Database.Database) => {
//   const sql = `
//     DROP TABLE "main"."download_list";

//     CREATE TABLE "download_list" (
//       "id" TEXT NOT NULL,
//       "isComplate" INTEGER NOT NULL,
//       "status" TEXT NOT NULL,
//       "statusText" TEXT NOT NULL,
//       "progress_downloaded" INTEGER NOT NULL,
//       "progress_total" INTEGER NOT NULL,
//       "url" TEXT,
//       "quality" TEXT NOT NULL,
//       "ext" TEXT NOT NULL,
//       "fileName" TEXT NOT NULL,
//       "filePath" TEXT NOT NULL,
//       "musicInfo" TEXT NOT NULL,
//       "position" INTEGER NOT NULL,
//       PRIMARY KEY("id")
//     );
//   `
//   db.exec(sql)
//   db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: '2' })
// }

const migrateV1 = (db: Database.Database) => {
  // 修复 v2.4.0 的默认数据库版本号不对的问题
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'dislike_list\';').get()
  if (!existsTable) {
    const sql = tables.get('dislike_list')!
    db.exec(sql)
  }
}

const ensureMusicUrlIndexes = (db: Database.Database) => {
  for (const name of ['index_music_url_id', 'index_music_url_expire_time'] as const) {
    const existsIndex = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'index\' AND name=?;').get(name)
    if (!existsIndex) db.exec(tables.get(name)!)
  }
}

const migrateV2 = (db: Database.Database) => {
  const existsTable = db.prepare('SELECT name FROM "main".sqlite_master WHERE type=\'table\' AND name=\'music_url\';').get()
  if (!existsTable) {
    db.exec(tables.get('music_url')!)
  } else {
    const columns = db.prepare('PRAGMA main.table_info(\'music_url\')').all() as Array<{ name: string }>
    if (!columns.some(column => column.name == 'expire_time')) {
      db.exec('ALTER TABLE "main"."music_url" ADD COLUMN "expire_time" INTEGER NOT NULL DEFAULT 0;')
    }
  }
  db.exec('DELETE FROM "main"."music_url";')
  ensureMusicUrlIndexes(db)
}

export default (db: Database.Database) => {
  // PRAGMA user_version = x
  // console.log(db.prepare('PRAGMA user_version').get().user_version)
  // https://github.com/WiseLibs/better-sqlite3/issues/668#issuecomment-1145285728
  const versionInfo = db.prepare<[string]>('SELECT "field_value" FROM "main"."db_info" WHERE "field_name" = ?').get('version') as { field_value: string } | undefined
  const version = versionInfo?.field_value
  if (version == DB_VERSION) {
    ensureMusicUrlIndexes(db)
    return
  }
  if (version != '1' && version != '2') return

  db.transaction(() => {
    if (version == '1') migrateV1(db)
    migrateV2(db)
    db.prepare('UPDATE "main"."db_info" SET "field_value"=@value WHERE "field_name"=@name').run({ name: 'version', value: DB_VERSION })
  })()
}
