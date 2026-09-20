import { app } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import type { PluginSourceManifest } from '@common/optionalPlugins'

export const compilePluginSource = async(source: string, output: string, manifest: PluginSourceManifest): Promise<void> => {
  let base = path.join(app.getAppPath(), 'dist/plugin-compiler')
  if (app.isPackaged && base.includes('app.asar' + path.sep)) base = base.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep)
  await new Promise<void>((resolve, reject) => {
    // Node 16 exposes WASI only with this flag. The compiler's WASM scanner
    // avoids loading modern Windows native binaries on Win7.
    const nodeArgs = Number(process.versions.node.split('.')[0]) < 18 ? ['--experimental-wasi-unstable-preview1'] : []
    const child = spawn(process.execPath, [...nodeArgs, path.join(base, 'worker.cjs')], {
      cwd: source,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NODE_OPTIONS: '' },
      // Node 16's WASI rejects Windows NUL as stdin (UVWASI_EINVAL). A pipe
      // supplies a valid handle without requiring a console or user input.
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    let failure = ''
    child.stdin?.end()
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
