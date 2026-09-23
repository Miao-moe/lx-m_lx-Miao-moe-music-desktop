import { stat, statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const getDownloadDiskSpace = async(target: string): Promise<{ availableBytes: number, totalBytes: number }> => {
  let directory = resolve(target)
  for (;;) {
    try {
      if (!(await stat(directory)).isDirectory()) directory = dirname(directory)
      break
    } catch (error: any) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error
      const parent = dirname(directory)
      if (parent === directory) throw error
      directory = parent
    }
  }
  const stats = await statfs(directory, { bigint: true })
  const safe = (value: bigint) => Number(value > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : value)
  return { availableBytes: safe(stats.bavail * stats.bsize), totalBytes: safe(stats.blocks * stats.bsize) }
}
