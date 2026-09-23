const MIB = 1024 * 1024
const BITRATES: Partial<Record<LX.Quality, number>> = { '128k': 128, '192k': 192, '320k': 320 }

export const downloadLimitBytes = (mib: number): number => Number.isFinite(mib) && mib > 0
  ? Math.floor(Math.min(mib, 102400) * MIB)
  : 0

export const parseDownloadSize = (size?: string | null): number | null => {
  if (!size) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]?)(?:I?B)?\s*$/i.exec(size)
  if (!match) return null
  const value = Number(match[1])
  const power = ['', 'K', 'M', 'G', 'T'].indexOf(match[2].toUpperCase())
  const bytes = value * 1024 ** power
  return Number.isSafeInteger(Math.round(bytes)) && bytes > 0 ? Math.round(bytes) : null
}

const durationSeconds = (interval: string | null): number | null => {
  if (!interval || !/^\d+(?::\d{1,2}){1,2}$/.test(interval)) return null
  const parts = interval.split(':').map(Number)
  if (parts.slice(1).some(part => part > 59)) return null
  const seconds = parts.reduce((total, part) => total * 60 + part, 0)
  return seconds > 0 ? seconds : null
}

export const estimateDownloadTask = (task: LX.Download.ListItem): { bytes: number | null, approximate: boolean } => {
  const { musicInfo, quality } = task.metadata
  const reported = musicInfo.meta.qualitys?.find(item => item.type === quality)?.size ?? musicInfo.meta._qualitys?.[quality]?.size
  const bytes = parseDownloadSize(reported)
  if (bytes != null) return { bytes, approximate: false }
  const seconds = durationSeconds(musicInfo.interval)
  const bitrate = BITRATES[quality]
  if (seconds != null && bitrate) return { bytes: Math.ceil(seconds * bitrate * 1000 / 8 * 1.03), approximate: true }
  return { bytes: null, approximate: false }
}

export interface DownloadStorageSummary {
  knownBytes: number
  knownCount: number
  approximateCount: number
  unknownCount: number
  overTaskCount: number
  overBatch: boolean
  insufficientDisk: boolean
}

export const summarizeDownloadStorage = (
  tasks: LX.Download.ListItem[],
  taskLimitBytes: number,
  batchLimitBytes: number,
  availableBytes: number | null,
): DownloadStorageSummary => {
  const summary: DownloadStorageSummary = { knownBytes: 0, knownCount: 0, approximateCount: 0, unknownCount: 0, overTaskCount: 0, overBatch: false, insufficientDisk: false }
  for (const task of tasks) {
    const estimate = estimateDownloadTask(task)
    if (estimate.bytes == null) { summary.unknownCount++; continue }
    summary.knownBytes += estimate.bytes
    if (estimate.approximate) summary.approximateCount++
    else summary.knownCount++
    if (taskLimitBytes && estimate.bytes > taskLimitBytes) summary.overTaskCount++
  }
  summary.overBatch = batchLimitBytes > 0 && summary.knownBytes > batchLimitBytes
  summary.insufficientDisk = availableBytes != null && summary.knownBytes > availableBytes
  return summary
}
