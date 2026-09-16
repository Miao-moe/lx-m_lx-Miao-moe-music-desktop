import { app } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { PluginSourceManifest } from '@common/optionalPlugins'

export const compilePluginSource = async(source: string, output: string, manifest: PluginSourceManifest): Promise<void> => {
  let base = path.join(app.getAppPath(), 'dist/plugin-compiler')
  if (app.isPackaged && base.includes('app.asar' + path.sep)) base = base.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(base, 'worker.cjs')], {
      cwd: source,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NODE_OPTIONS: '' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    let failure = ''
    let success = false
    const cancel = () => { failure = 'Plugin compilation cancelled'; child.kill() }
    app.once('before-quit', cancel)
    const timer = setTimeout(() => { failure = 'Plugin compilation timed out'; child.kill() }, 180_000)
    child.stdout?.on('data', () => {})
    child.stderr?.on('data', (chunk: Buffer) => { failure = (failure + chunk.toString()).slice(-6000) })
    child.on('message', (result: { success?: boolean, message?: string }) => {
      success = result.success === true
      if (result.message) failure = result.message
    })
    child.once('error', error => { clearTimeout(timer); app.removeListener('before-quit', cancel); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      app.removeListener('before-quit', cancel)
      if (success && code === 0) resolve()
      else reject(new Error(failure || `Plugin compiler exited (${code ?? 'terminated'})`))
    })
    child.send({ source, output, manifest })
  })
}
