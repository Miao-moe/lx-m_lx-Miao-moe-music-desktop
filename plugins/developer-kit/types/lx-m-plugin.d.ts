// Matches LX-M's plugin API 3. Use import type: this is not a runtime module.
declare module 'lx-m-plugin' {
  import type { Component, Ref } from 'vue'

  export type PluginText = string | Record<string, string>
  export interface PluginDownloadTask {
    id: string
    isComplate: boolean
    status: string
    metadata: { filePath: string, fileName: string }
  }
  export interface PluginDownloadAction {
    id: string
    name: PluginText
    isAvailable: (task: PluginDownloadTask) => boolean
    run: (taskId: string, context: { openSettings: () => Promise<void> }) => Promise<void>
  }
  export interface PluginContext {
    id: string
    apiVersion: number
    version: string
    assetUrl: (name: string) => string
    readAsset: (name: string) => Promise<Uint8Array>
  }
  export interface PluginModule {
    components: Record<string, Component>
    slots?: { playDetailControls?: Component, desktopLyricOverlay?: Component }
    playDetail?: { component: Component, enabled: Readonly<Ref<boolean>> }
    downloadActions?: PluginDownloadAction[]
    activate?: (context: PluginContext) => (() => void)
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent
  export default component
}
