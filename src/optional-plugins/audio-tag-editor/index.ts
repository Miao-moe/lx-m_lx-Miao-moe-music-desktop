import Settings from './Settings.vue'
import type { PluginModule } from '@common/optionalPluginTypes'
import { canEditDownload } from './downloadFile'
import { openDownload } from './actions'
import { editor } from './session'

export default {
  components: { Settings },
  activate() {
    editor.active = true
    return () => { editor.active = false }
  },
  downloadActions: [{
    id: 'edit-tags',
    name: { 'zh-cn': '修改音频标签', 'zh-tw': '修改音訊標籤', 'en-us': 'Edit audio tags' },
    isAvailable: task => !editor.busy && canEditDownload(task),
    async run(id, context) {
      if (await openDownload(id, true) && editor.active) await context.openSettings()
    },
  }],
} satisfies PluginModule
