import soundEffects from '../optional-plugins/sound-effects/store.json'
import soundEffectsManifest from '../optional-plugins/sound-effects/manifest.json'
import audioTagEditor from '../optional-plugins/audio-tag-editor/store.json'
import audioTagEditorManifest from '../optional-plugins/audio-tag-editor/manifest.json'
import type { PluginDisplayInfo } from './optionalPlugins'

interface BuiltinPlugin extends PluginDisplayInfo {
  id: string
  version: string
}

// These IDs belong to the application, even when an older installation or catalog contains them.
export const builtinPlugins: readonly BuiltinPlugin[] = [
  { id: soundEffectsManifest.id, version: soundEffectsManifest.version, ...soundEffects },
  { id: audioTagEditorManifest.id, version: audioTagEditorManifest.version, ...audioTagEditor },
]
export const getBuiltinPlugin = (id: string) => builtinPlugins.find(plugin => plugin.id === id)
export const isBuiltinPlugin = (id: string) => !!getBuiltinPlugin(id)
