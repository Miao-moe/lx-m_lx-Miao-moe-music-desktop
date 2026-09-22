export const downloadFailureKinds = ['network', 'timeout', 'permission', 'disk', 'http', 'url', 'conflict', 'postprocess', 'unknown'] as const
export type DownloadFailureKind = typeof downloadFailureKinds[number]
export const classifyDownloadError = (error: { code?: string, statusCode?: number, message?: string } = {}): DownloadFailureKind => {
  if (error.code === 'ERR_DOWNLOAD_URL') return 'url'
  if (error.code === 'ETIMEDOUT' || /timeout/i.test(error.message ?? '')) return 'timeout'
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH', 'EPIPE'].includes(error.code ?? '')) return 'network'
  if (['EACCES', 'EPERM', 'EROFS'].includes(error.code ?? '')) return 'permission'
  if (['ENOSPC', 'EDQUOT', 'EIO', 'ENOENT', 'ENOTDIR'].includes(error.code ?? '')) return 'disk'
  if (error.code === 'EEXIST') return 'conflict'
  if (error.statusCode) return [401, 403, 410].includes(error.statusCode) ? 'url' : 'http'
  return 'unknown'
}
