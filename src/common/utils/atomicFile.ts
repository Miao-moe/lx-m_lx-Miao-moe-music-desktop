import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// The destination is only replaced after the complete temporary file is durable.
export const writeFileAtomic = async(filename: string, data: string | Buffer) => {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try { await file.writeFile(data); await file.sync() } finally { await file.close() }
    await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
}
