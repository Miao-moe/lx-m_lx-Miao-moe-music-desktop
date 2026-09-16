import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent, ProxyAgent, interceptors, request as undiciRequest } from 'undici'
import { log, isLinux } from '@common/utils'
import { mainOn } from '@common/mainIpc'
import { isExistWindow, sendEvent } from './index'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { getProxy } from '@main/utils'
import { quitApp } from '@main/app'
import { APP_NAME } from '@common/constants'
import { getWindowsSetupPriority } from '@common/utils/update'
import { launchWindowsInstaller } from './updateInstaller'

interface DownloadedUpdate {
  filePath: string
  sha256: string
  size: number
}

const updateState: {
  downloaded: DownloadedUpdate | null
  controller: AbortController | null
  installing: boolean
} = { downloaded: null, controller: null, installing: false }

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

const removeUpdateFile = (filePath: string) => {
  try { fs.unlinkSync(filePath) } catch {}
  // Every download owns a directory created with mkdtemp. Only remove it if empty.
  try { fs.rmdirSync(path.dirname(filePath)) } catch {}
}

const downloadUpdate = async({ downloadUrl: url, fileName, digest, size }: LX.UpdateDownloadInfo) => {
  if (updateState.controller != null || updateState.installing) {
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, '已有更新任务正在进行中')
    return
  }
  const controller = updateState.controller = new AbortController()
  const tempName = fileName || `lx-m-music-desktop-update-${Date.now()}`
  let tempPath: string | null = null
  let dispatcher: ReturnType<typeof buildDownloadDispatcher> | null = null

  try {
    if (tempName == '.' || tempName == '..' || /[/\\\0]/.test(tempName)) throw new Error('更新文件名无效')
    if (process.platform == 'win32' && !getWindowsSetupPriority(tempName, process.arch)) {
      throw new Error('未找到适用于当前系统架构的 Setup 安装包，请手动更新')
    }
    if (updateState.downloaded) {
      removeUpdateFile(updateState.downloaded.filePath)
      updateState.downloaded = null
    }
    tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lx-m-update-')), tempName)
    log.info(`update download start: ${url} -> ${tempPath}`)
    dispatcher = buildDownloadDispatcher()
    const response = await undiciRequest(url, {
      method: 'GET',
      dispatcher,
      headersTimeout: 30000,
      bodyTimeout: 0,
      headers: { 'User-Agent': 'lx-m-music-desktop' },
      signal: controller.signal,
    })

    if (response.statusCode !== 200) {
      response.body.destroy()
      throw new Error(`下载失败，状态码: ${response.statusCode}`)
    }

    const total = parseInt(response.headers['content-length'] as string, 10) || 0
    const hash = crypto.createHash('sha256')
    let transferred = 0
    let lastReportTime = Date.now()
    let lastReportBytes = 0

    const progressStream = new Transform({
      transform(chunk: Buffer, encoding, callback) {
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
        callback(null, chunk)
      },
    })
    await pipeline(response.body, progressStream, fs.createWriteStream(tempPath, { flags: 'wx' }), { signal: controller.signal })
    if (!transferred || (size > 0 && transferred != size) || (total > 0 && transferred != total)) {
      throw new Error('更新安装包下载不完整，请重新下载')
    }

    const actualHash = hash.digest('hex')
    if (digest) {
      const expectedHash = digest.replace(/^sha256:/i, '').toLowerCase()
      if (actualHash !== expectedHash) {
        throw new Error(`SHA-256 校验失败\n期望: ${expectedHash}\n实际: ${actualHash}`)
      }
      log.info('update download SHA-256 verification passed')
    } else {
      log.warn('update download: no digest provided, SHA-256 verification skipped')
    }

    if (isLinux) {
      try { fs.chmodSync(tempPath, 0o755) } catch {}
    }

    updateState.downloaded = { filePath: tempPath, sha256: actualHash, size: transferred }
    updateState.controller = null
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_downloaded, { fileName: tempName })
  } catch (err: any) {
    if (tempPath) removeUpdateFile(tempPath)
    if (!controller.signal.aborted) {
      log.error('update download error:', err)
      sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
    }
  } finally {
    await dispatcher?.close().catch(error => { log.warn('update download dispatcher close error:', error) })
    if (updateState.controller === controller) updateState.controller = null
  }
}

const quitAndInstall = async() => {
  if (updateState.installing) return
  updateState.installing = true
  try {
    if (updateState.controller) throw new Error('更新安装包尚未下载完成')
    const update = updateState.downloaded
    if (!update || !fs.existsSync(update.filePath)) throw new Error('更新安装包不存在，请重新下载更新')
    const stat = await fs.promises.lstat(update.filePath)
    if (!stat.isFile() || stat.size == 0 || stat.size != update.size) throw new Error('更新安装包不完整，请重新下载更新')
    const hash = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(update.filePath)) hash.update(chunk)
    if (hash.digest('hex') != update.sha256) throw new Error('更新安装包已发生变化，请重新下载更新')

    const installDirectory = path.dirname(app.getPath('exe'))
    const isWindowsInstall = process.platform == 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE &&
      fs.existsSync(path.join(installDirectory, `Uninstall ${APP_NAME}.exe`))
    if (isWindowsInstall) {
      log.info(`starting silent update: ${update.filePath} -> ${installDirectory}`)
      await launchWindowsInstaller(update.filePath, installDirectory, process.resourcesPath)
    } else {
      const errorMsg = await shell.openPath(update.filePath)
      if (errorMsg) throw new Error(`无法打开安装程序: ${errorMsg}`)
    }

    // Transfer ownership only after the installer starts. Keep the file on
    // failure, and do not let will-quit delete an installer that is still running.
    updateState.downloaded = null
    // NSIS --updated waits for the old app to close; start the normal shutdown
    // immediately so window-close handlers can save state and bypass the tray.
    if (isWindowsInstall) quitApp()
    else setTimeout(() => { quitApp() }, 1000)
  } catch (err: any) {
    updateState.installing = false
    log.error('failed to install update:', err)
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
  }
}

export default () => {
  mainOn<LX.UpdateDownloadInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.update_download_update, ({ params }) => {
    if (params?.downloadUrl) {
      void downloadUpdate(params)
    } else if (!updateState.installing) {
      updateState.controller?.abort()
      if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
      updateState.downloaded = null
    }
  })

  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.quit_update, () => {
    void quitAndInstall()
  })

  app.on('will-quit', () => {
    updateState.controller?.abort()
    if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
  })
}
