import { createDownload, type DownloaderType } from '@common/utils/download'
import { classifyDownloadError } from '@common/utils/download/errors'
import { checkAndCreateDir, removeFile } from '@common/utils/nodejs'
import fs from 'node:fs/promises'
import { createDownloadInfo } from './utils'
import { reserveDownloadPath } from './fileLease'

interface Task {
  info: LX.Download.ListItem
  callback: (action: LX.Download.DownloadTaskActions) => void
  cancelled: boolean
  downloader?: DownloaderType
  retryTimer?: NodeJS.Timeout
  retries: number
  preparing?: Promise<void>
  recovery?: Promise<void>
  lease?: Awaited<ReturnType<typeof reserveDownloadPath>>
}
const tasks = new Map<string, Task>()
const current = (task: Task) => !task.cancelled && tasks.get(task.info.id) === task
const send = (task: Task, action: LX.Download.DownloadTaskActions) => { if (current(task)) task.callback(action) }
export const checkList = (list: LX.Download.ListItem[], info: LX.Music.MusicInfo, quality: LX.Quality, ext: string) =>
  list.some(item => item.metadata.musicInfo.id === info.id && (item.metadata.quality === quality || item.metadata.ext === ext))
export const createDownloadTasks = (list: LX.Music.MusicInfoOnline[], quality: LX.Quality, format: string, qualityList: LX.QualityList, listId?: string) =>
  list.map(info => createDownloadInfo(info, quality, format, qualityList, listId))

const reportError = (task: Task, error: any) => {
  send(task, {
    action: 'error', data: { message: error.message, code: String(error.code ?? error.statusCode ?? ''), kind: classifyDownloadError(error) },
  })
}
const retry = async(task: Task, error: any) => {
  if (!current(task)) return
  const kind = classifyDownloadError(error)
  if (++task.retries > 2 || ['permission', 'disk', 'conflict'].includes(kind) || [400, 404, 429].includes(error.statusCode)) {
    reportError(task, error)
    return
  }
  const downloader = task.downloader
  task.recovery = (async() => {
    try {
      await downloader?.stop()
      if (!current(task)) return
      if (error.code === 'ERR_DOWNLOAD_RESUME') {
        await fs.truncate(task.info.metadata.filePath, 0)
        if (!current(task)) return
        task.info.downloaded = 0
      }
      if (kind === 'url') { send(task, { action: 'refreshUrl' }); return }
      task.retryTimer = setTimeout(() => {
        task.retryTimer = undefined
        if (current(task) && task.downloader === downloader) void downloader?.start().catch(error => { reportError(task, error) })
      }, task.retries * 1000)
    } catch (error) { reportError(task, error) }
  })()
  await task.recovery
}
const stop = async(task: Task) => {
  task.cancelled = true
  if (tasks.get(task.info.id) === task) tasks.delete(task.info.id)
  clearTimeout(task.retryTimer)
  try {
    await task.preparing
    await task.recovery
    await task.downloader?.stop()
  } finally { task.lease?.release() }
}
export const pauseTask = async(id: string) => {
  const task = tasks.get(id)
  if (task) await stop(task)
}
export const removeTask = async(id: string) => {
  const task = tasks.get(id)
  if (!task) return
  await stop(task)
  if (!task.info.audioDownloaded && !task.info.isComplate && task.info.downloaded > 1024) await removeFile(task.info.metadata.filePath).catch(() => {})
}
export const startTask = async(info: LX.Download.ListItem, savePath: string, skipExisting: boolean, callback: Task['callback'], proxy?: { host: string, port: number }, rateLimit = 0) => {
  const previous = tasks.get(info.id)
  const stopped = previous ? stop(previous) : Promise.resolve()
  const task: Task = { info, callback, cancelled: false, retries: 0 }
  tasks.set(info.id, task)
  task.preparing = (async() => {
    try {
      await stopped
      if (!current(task)) return
      const ready = await checkAndCreateDir(savePath)
      if (!current(task)) return
      if (!ready) throw Object.assign(new Error('Unable to create download folder'), { code: 'EACCES' })
      const lease = await reserveDownloadPath(savePath, info.metadata.fileName, !!info.metadata.fileAllocated || info.downloaded > 0, skipExisting, () => current(task))
      task.lease = lease
      if (!current(task) || !lease) { await lease?.discard(); return }
      info.metadata.fileName = lease.fileName
      info.metadata.filePath = lease.filePath
      info.metadata.fileAllocated = true
      send(task, { action: 'filePath', data: { fileName: lease.fileName, filePath: lease.filePath } })
      if (!current(task)) return
      task.downloader = createDownload({
        url: info.metadata.url ?? '',
        path: savePath,
        fileName: lease.fileName,
        proxy,
        rateLimit,
        onCompleted() { info.audioDownloaded = true; send(task, { action: 'complete' }) },
        onStart() { send(task, { action: 'start' }) },
        onProgress(progress) { if (!current(task)) return; Object.assign(info, progress); send(task, { action: 'progress', data: progress }) },
        onError(error) { void retry(task, error) },
        onFail(response) { void retry(task, { statusCode: response.statusCode, message: 'HTTP ' + response.statusCode }) },
      })
    } catch (error) { reportError(task, error) }
  })()
  await task.preparing
}
export const updateUrl = async(id: string, url: string) => {
  const task = tasks.get(id)
  if (!task || !current(task) || !task.downloader) return
  if (!url) { reportError(task, { message: 'Empty download URL', statusCode: 403 }); return }
  task.info.metadata.url = url
  task.downloader.refreshUrl(url)
  await task.downloader.start()
}
export const setRateLimit = (bytesPerSecond: number) => {
  for (const task of tasks.values()) task.downloader?.setRateLimit(bytesPerSecond)
}
