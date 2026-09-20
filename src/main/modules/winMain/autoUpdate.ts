import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Agent, ProxyAgent } from 'undici'
import { composeDispatcher, requestWithCompatibility } from '@common/utils/undiciCompat'
import { log, isLinux } from '@common/utils'
import { mainHandle, mainOn } from '@common/mainIpc'
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
  installController: AbortController | null
  installPromise: Promise<void> | null
} = { downloaded: null, controller: null, installing: false, installController: null, installPromise: null }

const sendStatusToWindow = <T = unknown>(name: string, params?: T) => {
  if (isExistWindow()) sendEvent(name, params)
}

const buildDownloadDispatcher = () => {
  const proxy = getProxy()
  const base = proxy
    ? new ProxyAgent(`http://${proxy.host}:${proxy.port}`)
    : new Agent()
  return composeDispatcher(base, 5)
}

const removeUpdateFile = (filePath: string) => {
  try { fs.unlinkSync(filePath) } catch {}
  // Every download owns a directory created with mkdtemp. Only remove it if empty.
  try { fs.rmdirSync(path.dirname(filePath)) } catch {}
}

const downloadUpdate = async({ downloadUrl: url, fileName, digest, size, installAfterDownload = false }: LX.UpdateDownloadInfo) => {
  if (updateState.controller != null || updateState.installing) {
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
    const expectedSize = Number.isSafeInteger(size) && size > 0 ? size : 0
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
      phase: 'downloading', progress: 0, transferred: 0, total: expectedSize, bytesPerSecond: 0,
    })
    dispatcher = buildDownloadDispatcher()
    const response = await requestWithCompatibility(url, {
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

    const contentLength = Number(response.headers['content-length'])
    const total = Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : expectedSize
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
        if (elapsed >= 0.5 && !controller.signal.aborted) {
          const bytesPerSecond = elapsed > 0 ? (transferred - lastReportBytes) / elapsed : 0
          sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
            phase: 'downloading',
            progress: total ? Math.min(100, (transferred / total) * 100) : 0,
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
    controller.signal.throwIfAborted()
    if (!transferred || (size > 0 && transferred != size) || (total > 0 && transferred != total)) {
      throw new Error('更新安装包下载不完整，请重新下载')
    }
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, {
      phase: 'verifying', progress: 100, transferred, total: total || transferred, bytesPerSecond: 0,
    })

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
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_downloaded, { fileName: tempName, installAfterDownload })
    if (installAfterDownload && !controller.signal.aborted) await quitAndInstall()
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

const installUpdate = async(controller: AbortController) => {
  const update = updateState.downloaded
  try {
    if (updateState.controller) throw new Error('更新安装包尚未下载完成')
    if (!update || !fs.existsSync(update.filePath)) throw new Error('更新安装包不存在，请重新下载更新')
    const stat = await fs.promises.lstat(update.filePath)
    controller.signal.throwIfAborted()
    if (!stat.isFile() || stat.size == 0 || stat.size != update.size) throw new Error('更新安装包不完整，请重新下载更新')
    const progress = { progress: 100, transferred: update.size, total: update.size, bytesPerSecond: 0 }
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, phase: 'verifying' })
    const hash = crypto.createHash('sha256')
    for await (const chunk of fs.createReadStream(update.filePath, { signal: controller.signal })) hash.update(chunk)
    if (hash.digest('hex') != update.sha256) throw new Error('更新安装包已发生变化，请重新下载更新')
    controller.signal.throwIfAborted()

    const installDirectory = path.dirname(app.getPath('exe'))
    const isWindowsInstall = process.platform == 'win32' && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE &&
      fs.existsSync(path.join(installDirectory, `Uninstall ${APP_NAME}.exe`))
    // From this point the installer can be running; cancellation must not claim
    // success or remove the file handed to it.
    updateState.installController = null
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_progress, { ...progress, phase: 'installing' })
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
    if (controller.signal.aborted) {
      if (update && updateState.downloaded === update) {
        updateState.downloaded = null
        removeUpdateFile(update.filePath)
      }
      return
    }
    log.error('failed to install update:', err)
    sendStatusToWindow(WIN_MAIN_RENDERER_EVENT_NAME.update_error, String(err?.message ?? err))
  } finally {
    if (updateState.installController === controller) updateState.installController = null
  }
}

const quitAndInstall = async() => {
  if (updateState.installing) return
  updateState.installing = true
  const controller = updateState.installController = new AbortController()
  const promise = updateState.installPromise = installUpdate(controller)
  try { await promise } finally {
    if (updateState.installPromise === promise) updateState.installPromise = null
  }
}

const cancelUpdate = async(): Promise<boolean> => {
  if (updateState.installing && !updateState.installController) return false
  updateState.controller?.abort()
  updateState.controller = null
  if (updateState.installController) {
    updateState.installController.abort()
    // Wait for the verification stream to close before allowing another task.
    await updateState.installPromise
  }
  if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
  updateState.downloaded = null
  return true
}

export default () => {
  mainOn<LX.UpdateDownloadInfo | null>(WIN_MAIN_RENDERER_EVENT_NAME.update_download_update, ({ params }) => {
    if (params?.downloadUrl) {
      void downloadUpdate(params)
    } else void cancelUpdate()
  })

  mainHandle<boolean>(WIN_MAIN_RENDERER_EVENT_NAME.update_cancel_update, cancelUpdate)

  mainOn(WIN_MAIN_RENDERER_EVENT_NAME.quit_update, () => {
    void quitAndInstall()
  })

  app.on('will-quit', () => {
    updateState.controller?.abort()
    updateState.installController?.abort()
    if (updateState.downloaded) removeUpdateFile(updateState.downloaded.filePath)
  })
}
