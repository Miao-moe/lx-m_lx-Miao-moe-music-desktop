import { getDB } from '../../db'

/**
 * 创建歌曲url查询语句
 * @returns 查询语句
 */
export const createQueryStatement = () => {
  const db = getDB()
  return db.prepare<[string, number]>(`
    SELECT "url"
    FROM "main"."music_url"
    WHERE "id"=? AND "expire_time">?
    `)
}

/**
 * 创建歌曲url插入语句
 * @returns 插入语句
 */
export const createInsertStatement = () => {
  const db = getDB()
  return db.prepare<[LX.DBService.MusicUrlInfo]>(`
    INSERT INTO "main"."music_url" ("id", "url", "expire_time")
    VALUES (@id, @url, @expire_time)`)
}

/**
 * 创建歌曲url清空语句
 * @returns 清空语句
 */
export const createClearStatement = () => {
  const db = getDB()
  return db.prepare<[]>(`
    DELETE FROM "main"."music_url"
  `)
}

/**
 * 创建歌曲url删除语句
 * @returns 删除语句
 */
export const createDeleteStatement = () => {
  const db = getDB()
  return db.prepare<[string]>(`
    DELETE FROM "main"."music_url"
    WHERE "id"=?
  `)
}

/**
 * 创建过期歌曲url清理语句
 * @returns 清理语句
 */
export const createDeleteExpiredStatement = () => {
  const db = getDB()
  return db.prepare<[number]>(`
    DELETE FROM "main"."music_url"
    WHERE "expire_time"<=?
  `)
}

/**
 * 创建歌曲url更新语句
 * @returns 更新语句
 */
export const createUpdateStatement = () => {
  const db = getDB()
  return db.prepare<[LX.DBService.MusicUrlInfo]>(`
    UPDATE "main"."music_url"
    SET "url"=@url, "expire_time"=@expire_time
    WHERE "id"=@id`)
}

/**
 * 创建数量统计语句
 * @returns 统计语句
 */
export const createCountStatement = () => {
  const db = getDB()
  return db.prepare<[number]>('SELECT COUNT(*) as count FROM "main"."music_url" WHERE "expire_time">?')
}
