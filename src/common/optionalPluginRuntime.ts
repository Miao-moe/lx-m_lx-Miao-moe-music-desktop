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

export const createPluginRuntime = (host: Record<string, unknown>, lyric = false) => {
  // Vue's Node ESM entry re-exports CommonJS; use that object directly to retain all helpers.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  window.__lxPluginHost = { ...host, vue: require('vue') as typeof vue }
  const components = vue.shallowReactive<Partial<Record<PluginId, PluginModule['components']>>>({})
  const playDetails = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['playDetail']>>>>({})
  const slots = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['slots']>>>>({})
  const downloadActions = vue.shallowReactive<Partial<Record<PluginId, NonNullable<PluginModule['downloadActions']>>>>({})
  const errors = vue.reactive<Partial<Record<PluginId, string>>>({})
  const loaded = new Map<PluginId, { directory?: string, dispose: () => void }>()
  let latest: PluginStoreSnapshot | null = null
  let queue: Promise<void> = Promise.resolve()
  let stopped = false

  const remove = async(id: PluginId) => {
    const plugin = loaded.get(id)
    Reflect.deleteProperty(components, id)
    Reflect.deleteProperty(playDetails, id)
    Reflect.deleteProperty(slots, id)
    Reflect.deleteProperty(downloadActions, id)
    await vue.nextTick()
    try { plugin?.dispose() } finally { loaded.delete(id) }
  }

  const mount = (id: PluginId, module: PluginModule, context: PluginContext, cleanup: () => void, directory?: string) => {
    const scope = vue.effectScope(true)
    let deactivate: (() => void) | undefined
    const dispose = () => {
      try { deactivate?.() } finally { scope.stop(); cleanup() }
    }
    try {
      if (!module?.components || typeof module.components != 'object') throw new Error('Invalid plugin module')
      deactivate = scope.run(() => module.activate?.(context))
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
    } catch (error) {
      dispose()
      throw error
    }
  }

  const registerBuiltin = (id: PluginId, module: PluginModule, context: PluginContext) => {
    if (stopped || lyric || loaded.has(id)) return
    if (!isBuiltinPlugin(id)) throw new Error('Unknown built-in feature')
    try { mount(id, module, context, () => {}) } catch (error: any) {
      errors[id] = error.message
      console.error(`Built-in feature ${id} failed to load:`, error)
    }
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
      for (const style of styles) style.remove()
      Reflect.deleteProperty(requirePlugin.cache, entryPath)
    }
    try {
      for (const name of (lyric ? manifest.lyricStyles : manifest.styles) ?? []) {
        const style = document.createElement('style')
        style.dataset.plugin = id
        style.textContent = await fs.readFile(path.join(directory, name), 'utf8')
        document.head.appendChild(style)
        styles.push(style)
      }
      if (stopped || latest?.installed[id]?.directory !== directory) { cleanup(); return }
      const module = requirePlugin(entryPath) as { default: PluginModule }
      mount(id, module.default, {
        id,
        apiVersion: PLUGIN_API_VERSION,
        version: manifest.version,
        assetUrl: name => pathToFileURL(path.join(directory, name)).href,
        readAsset: async name => fs.readFile(path.join(directory, name)),
      }, cleanup, directory)
    } catch (error: any) {
      cleanup()
      loaded.delete(id)
      Reflect.deleteProperty(components, id)
      Reflect.deleteProperty(playDetails, id)
      Reflect.deleteProperty(slots, id)
      Reflect.deleteProperty(downloadActions, id)
      errors[id] = error.message
      console.error(`Plugin ${id} failed to load:`, error)
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
        const installed = latest?.installed[id]
        if (installed && installed.directory === loaded.get(id)?.directory) continue
        await remove(id)
        if (installed) await load(id, installed)
        else Reflect.deleteProperty(errors, id)
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
    sync,
    registerBuiltin,
    async unload(id: PluginId) { if (!isBuiltinPlugin(id)) await remove(id) },
    async dispose() {
      stopped = true
      await queue
      for (const id of loaded.keys()) await remove(id)
    },
  }
}
