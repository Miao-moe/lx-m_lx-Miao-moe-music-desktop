import { errorForTransport } from '@common/utils/errorMessage'
import * as vue from 'vue'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_API_VERSION, type InstalledPlugin, type PluginId, type PluginStoreSnapshot } from './optionalPlugins'
import type { PluginContext, PluginModule } from './optionalPluginTypes'
import { isBuiltinPlugin } from './builtinPlugins'

declare const __non_webpack_require__: NodeJS.Require

declare global {
  interface Window {
    __lxPluginHost: Record<string, unknown>
  }
}

export const createPluginRuntime = (host: Record<string, unknown>, lyric = false, report?: (id: PluginId, directory: string, error?: string) => Promise<PluginStoreSnapshot>) => {
  // Vue's Node ESM entry re-exports CommonJS; use that object directly to retain all helpers.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  window.__lxPluginHost = { ...host, vue: require('vue') as typeof vue }
  const components = vue.shallowReactive<Partial<Record<PluginId, PluginModule['components']>>>({})
  const playDetails = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['playDetail']>>>>({})
  const slots = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['slots']>>>>({})
  const downloadActions = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['downloadActions']>>>>({})
  const errors = vue.reactive<Partial<Record<PluginId, string>>>({})
  const cleanupErrors = vue.reactive<Partial<Record<PluginId, string>>>({})
  const loaded = new Map<PluginId, { directory?: string, dispose: () => Promise<void> }>()
  const failed = new Map<PluginId, string>()
  let latest: PluginStoreSnapshot | null = null
  let queue: Promise<void> = Promise.resolve()
  let stopped = false

  const cleanupFailure = (id: PluginId, error: unknown) => {
    cleanupErrors[id] = errorForTransport(error).message
    console.error(`Plugin ${id} cleanup failed:`, error)
  }
  const clearContributions = (id: PluginId) => {
    for (const contributions of [components, playDetails, slots, downloadActions]) Reflect.deleteProperty(contributions, id)
  }
  const current = (id: PluginId, directory: string) => !stopped && latest?.installed[id]?.enabled !== false && latest?.installed[id]?.directory === directory
  const notify = async(id: PluginId, directory: string, error?: string) => {
    if (!report || !current(id, directory)) return
    try {
      const snapshot = await report(id, directory, error)
      if (!latest || snapshot.revision >= latest.revision) latest = snapshot
    } catch (error) { console.error(`Plugin ${id} runtime result could not be saved:`, error) }
  }

  const remove = async(id: PluginId) => {
    const plugin = loaded.get(id)
    loaded.delete(id)
    clearContributions(id)
    try { await vue.nextTick() } catch (error) { cleanupFailure(id, error) }
    try { await plugin?.dispose() } catch (error) { cleanupFailure(id, error) }
  }

  const mount = async(id: PluginId, module: PluginModule, context: PluginContext, cleanup: () => void, directory?: string) => {
    const scope = vue.effectScope(true)
    let deactivate: (() => void | Promise<void>) | undefined
    const dispose = async() => {
      // Always release host effects and module caches, even when the plugin's
      // own asynchronous teardown rejects.
      for (const release of [async() => { await deactivate?.() }, async() => { scope.stop() }, async() => { cleanup() }]) {
        try { await release() } catch (error) { cleanupFailure(id, error) }
      }
    }
    try {
      if (!module?.components || typeof module.components != 'object') throw new Error('Invalid plugin module')
      deactivate = await scope.run(async() => module.activate?.(context))
      if (deactivate != null && typeof deactivate !== 'function') throw new Error('Invalid plugin cleanup callback')
      if (stopped || (directory && !current(id, directory))) { await dispose(); return false }
      loaded.set(id, { directory, dispose })
      components[id] = vue.markRaw(module.components)
      if (module.playDetail) playDetails[id] = vue.markRaw({ ...module.playDetail, component: vue.markRaw(module.playDetail.component) })
      // Existing lyric plugins used a Toggle component alongside their player surface.
      slots[id] = vue.markRaw({
        ...(module.playDetail && module.components.Toggle ? { playDetailControls: module.components.Toggle } : {}),
        ...module.slots,
      })
      if (!lyric && module.downloadActions) downloadActions[id] = vue.markRaw(module.downloadActions)
      Reflect.deleteProperty(errors, id)
      return true
    } catch (error) {
      clearContributions(id)
      loaded.delete(id)
      await dispose()
      throw error
    }
  }

  const registerBuiltin = (id: PluginId, module: PluginModule, context: PluginContext) => {
    if (stopped || lyric || loaded.has(id)) return
    if (!isBuiltinPlugin(id)) throw new Error('Unknown built-in feature')
    void mount(id, module, context, () => {}).catch((error: any) => {
      errors[id] = errorForTransport(error).message
      console.error(`Built-in feature ${id} failed to load:`, error)
    })
  }

  const load = async(id: PluginId, installed: InstalledPlugin) => {
    const { directory, manifest } = installed
    const entry = lyric ? manifest.lyricEntry : manifest.entry
    if (!entry) return
    const entryPath = path.join(directory, entry)
    // Installed modules are loaded by Node, outside Webpack's module graph.
    const requirePlugin = __non_webpack_require__
    const styles: HTMLStyleElement[] = []
    const cleanup = () => {
      for (const style of styles) {
        try { style.remove() } catch (error) { cleanupFailure(id, error) }
      }
      // Include lazy-loaded helpers and failed-entry dependencies. Keep host
      // modules and dependencies outside this installation in the shared cache.
      const root = path.resolve(directory) + path.sep
      const owned = new Set(Object.keys(requirePlugin.cache).filter(filename => {
        const file = path.resolve(filename)
        return process.platform === 'win32' ? file.toLowerCase().startsWith(root.toLowerCase()) : file.startsWith(root)
      }))
      const parents = new Set(Object.values(requirePlugin.cache))
      for (const filename of owned) {
        const parent = requirePlugin.cache[filename]?.parent
        if (parent) parents.add(parent)
      }
      for (const module of parents) {
        if (module) module.children = module.children.filter(child => !owned.has(child.filename))
      }
      for (const filename of owned) Reflect.deleteProperty(requirePlugin.cache, filename)
    }
    try {
      for (const name of (lyric ? manifest.lyricStyles : manifest.styles) ?? []) {
        const style = document.createElement('style')
        style.dataset.plugin = id
        style.textContent = await fs.readFile(path.join(directory, name), 'utf8')
        document.head.appendChild(style)
        styles.push(style)
      }
      if (!current(id, directory)) { cleanup(); return }
      const module = requirePlugin(entryPath) as { default: PluginModule }
      const mounted = await mount(id, module.default, {
        id,
        apiVersion: PLUGIN_API_VERSION,
        version: manifest.version,
        assetUrl: name => pathToFileURL(path.join(directory, name)).href,
        readAsset: async name => fs.readFile(path.join(directory, name)),
      }, cleanup, directory)
      if (!mounted) return
      failed.delete(id)
      await notify(id, directory)
    } catch (error: any) {
      cleanup()
      loaded.delete(id)
      clearContributions(id)
      errors[id] = errorForTransport(error).message
      failed.set(id, directory)
      console.error(`Plugin ${id} failed to load:`, error)
      await notify(id, directory, errors[id])
    }
  }

  const sync = async(snapshot: PluginStoreSnapshot) => {
    if (stopped || (latest && snapshot.revision < latest.revision)) return
    latest = snapshot
    const task = queue.then(async() => {
      if (stopped) return
      const ids = new Set([...loaded.keys(), ...Object.keys(errors), ...Object.keys(latest?.installed ?? {})])
      for (const id of ids) {
        if (isBuiltinPlugin(id)) continue
        // Reconcile installations changed while an asynchronous load was running.
        for (;;) {
          const installed = latest?.installed[id]?.enabled === false ? undefined : latest?.installed[id]
          if (installed && (installed.directory === loaded.get(id)?.directory || installed.directory === failed.get(id))) break
          await remove(id)
          if (installed) await load(id, installed)
          else { failed.delete(id); Reflect.deleteProperty(errors, id) }
          if (stopped || latest?.installed[id]?.directory === installed?.directory || (!installed && latest?.installed[id]?.enabled === false)) break
        }
      }
    })
    queue = task.catch(console.error)
    return task
  }

  return {
    components,
    playDetails,
    slots,
    downloadActions,
    errors,
    cleanupErrors,
    sync,
    registerBuiltin,
    async unload(id: PluginId) {
      if (isBuiltinPlugin(id)) return
      const task = queue.then(async() => remove(id))
      queue = task.catch(console.error)
      await task
    },
    async dispose() {
      stopped = true
      await queue
      for (const id of [...loaded.keys()]) await remove(id)
    },
  }
}
