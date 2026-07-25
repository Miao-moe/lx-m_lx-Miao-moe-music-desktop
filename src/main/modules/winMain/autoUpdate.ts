import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Agent, ProxyAgent, interceptors, request as undiciRequest } from 'undici'
import { log, isLinux } from '@common/utils'
import { mainOn } from '@common/mainIpc'
import { isExistWindow, sendEvent } from './index'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getProxy } from '@main/utils'
import { quitApp } from '@main/app'

let downloadedFilePath: string | null = null
let isDownloading = false

const sendStatusToWindow = <T = unknown>(name: string, params?: T) => {
  if (isExistWindow()) sendEvent(name, params)
}

const buildDownloadDispatcher = () => {
  const proxy = getProxy()
  const base = proxy
    ? new ProxyAgent(`http://${proxy.host}:${proxy.port}`)
    : new Agent()
  return base.compose(interceptors.redirect({ maxRedirections: 5 }))
}

const downloadUpdate = async({ downloadUrl: url, fileName, digest }: LX.UpdateDownloadInfo) => {
  if (isDownloading) {
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, '已有下载任务正在进行中')
    return
  }
  isDownloading = true
  const tempName = fileName || `lx-music-desktop-update-${Date.now()}`
  const tempPath = path.join(os.tmpdir(), tempName)
  log.info(`update download start: ${url} -> ${tempPath}`)

  try {
    const dispatcher = buildDownloadDispatcher()
    const response = await undiciRequest(url, {
      method: 'GET',
      dispatcher,
      headersTimeout: 30000,
      bodyTimeout: 0,
      headers: { 'User-Agent': 'lx-music-desktop' },
    })

    if (response.statusCode !== 200) {
      throw new Error(`下载失败，状态码: ${response.statusCode}`)
    }

    const total = parseInt(response.headers['content-length'] as string, 10) || 0
    const fileStream = fs.createWriteStream(tempPath)
    const hash = crypto.createHash('sha256')
    let transferred = 0
    let lastReportTime = Date.now()
    let lastReportBytes = 0

    await new Promise<void>((resolve, reject) => {
      response.body.on('data', (chunk: Buffer) => {
        fileStream.write(chunk)
        hash.update(chunk)
        transferred += chunk.length
        const now = Date.now()
        const elapsed = (now - lastReportTime) / 1000
        if (elapsed >= 0.5) {
          const bytesPerSecond = elapsed > 0 ? (transferred - lastReportBytes) / elapsed : 0
          sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
            progress: total ? (transferred / total) * 100 : 0,
            transferred,
            total,
            bytesPerSecond,
          })
          lastReportTime = now
          lastReportBytes = transferred
        }
      })
      response.body.on('end', () => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err)
          else resolve()
        })
      })
      response.body.on('error', reject)
      fileStream.on('error', reject)
    })

    const actualHash = hash.digest('hex')
    if (digest) {
      const expectedHash = digest.replace(/^sha256:/i, '').toLowerCase()
      if (actualHash !== expectedHash) {
        try { fs.unlinkSync(tempPath) } catch {}
        throw new Error(`SHA-256 校验失败\n期望: ${expectedHash}\n实际: ${actualHash}`)
      }
      log.info('update download SHA-256 verification passed')
    } else {
      log.warn('update download: no digest provided, SHA-256 verification skipped')
    }

    if (isLinux) {
      try { fs.chmodSync(tempPath, 0o755) } catch {}
    }

    downloadedFilePath = tempPath
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_downloaded, { fileName: tempName })
  } catch (err: any) {
    log.error('update download error:', err)
    try { fs.existsSync(tempPath) && fs.unlinkSync(tempPath) } catch {}
    downloadedFilePath = null
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
  } finally {
    // eslint-disable-next-line require-atomic-updates
    isDownloading = false
  }
}

const quitAndInstall = async() => {
  if (!downloadedFilePath || !fs.existsSync(downloadedFilePath)) {
    quitApp()
    return
  }
  const filePath = downloadedFilePath
  downloadedFilePath = null
  log.info(`opening installer: ${filePath}`)
  try {
    const errorMsg = await shell.openPath(filePath)
    if (errorMsg) {
      log.error(`failed to open installer: ${errorMsg}`)
      sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, `无法打开安装程序: ${errorMsg}`)
      return
    }
  } catch (err: any) {
    log.error('failed to open installer:', err)
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
    return
  }
  setTimeout(() => {
    quitApp()
  }, 1000)
}

export default () => {
  mainOn<LX.UpdateDownloadInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.update_download_update, ({ params }) => {
    if (params?.downloadUrl) {
      void downloadUpdate(params)
    } else {
      isDownloading = false
      downloadedFilePath = null
    }
  })

  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.quit_update, () => {
    void quitAndInstall()
  })

  app.on('will-quit', () => {
    if (downloadedFilePath) {
      try { fs.existsSync(downloadedFilePath) && fs.unlinkSync(downloadedFilePath) } catch {}
    }
  })
}
