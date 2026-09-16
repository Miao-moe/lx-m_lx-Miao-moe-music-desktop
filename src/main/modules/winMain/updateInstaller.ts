import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const spawnInstaller = async(command: string, args: string[]) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // NSIS requires /D= to be last and unquoted, even for paths with spaces.
      // Quote argv[0] ourselves because Node's automatic quoting is disabled.
      argv0: `"${command}"`,
      windowsVerbatimArguments: true,
      cwd: path.dirname(command),
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

export const launchWindowsInstaller = async(filePath: string, installDirectory: string, resourcesPath: string) => {
  for (const target of [filePath, installDirectory, resourcesPath]) {
    if (!path.win32.isAbsolute(target) || /["\0\r\n]/.test(target)) throw new Error('更新安装路径无效')
  }
  const args = ['--updated', '/S', '--force-run', `/D=${installDirectory}`]
  try {
    await spawnInstaller(filePath, args)
  } catch (error: any) {
    // Some installations require elevation. Keep the silent arguments when
    // using electron-builder's bundled helper; never fall back to opening a wizard.
    if (!['EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) throw error
    const elevatePath = path.join(resourcesPath, 'elevate.exe')
    await fs.promises.access(elevatePath, fs.constants.R_OK)
    await spawnInstaller(elevatePath, [`"${filePath}"`, ...args])
  }
}
