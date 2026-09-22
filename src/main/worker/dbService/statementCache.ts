import type Database from 'better-sqlite3'

// The worker uses unbound statements. Keep their compiled plans with the owning
// connection; never share an active iterator or grow the cache without a limit.
export const cacheStatements = (db: Database.Database, capacity = 256) => {
  const prepare = db.prepare.bind(db)
  const statements = new Map<string, Database.Statement>()
  db.prepare = ((sql: string) => {
    let statement = statements.get(sql)
    if (statement?.busy) return prepare(sql)
    if (!statement) statement = prepare(sql)
    statements.delete(sql)
    statements.set(sql, statement)
    while (statements.size > capacity) statements.delete(statements.keys().next().value!)
    return statement
  }) as Database.Database['prepare']
  return () => { statements.clear(); db.prepare = prepare }
}
