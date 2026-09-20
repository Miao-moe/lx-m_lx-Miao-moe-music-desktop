<template>
  <material-modal
    :show="visible" :bg-close="!busy" :close-btn="!busy" width="min(760px, calc(100vw - 32px))"
    max-width="calc(100vw - 32px)" max-height="calc(100vh - 48px)" @close="close"
  >
    <section :class="$style.main" role="dialog" aria-labelledby="list-trash-title" data-list-trash>
      <header :class="$style.header">
        <h2 id="list-trash-title">{{ $t('list_trash__title') }}</h2>
        <p>{{ $t('list_trash__tip', { days: retentionDays }) }}</p>
      </header>
      <div :class="$style.toolbar">
        <span>{{ $t('list_trash__total', { count: entries.length }) }}</span>
        <base-btn :disabled="busy || loading || !entries.length" @click="removeEntries(entries)">{{ $t('list_trash__empty') }}</base-btn>
      </div>
      <div class="scroll" :class="$style.content" :aria-busy="busy || loading">
        <p v-if="loading" :class="$style.message" role="status">{{ $t('list_trash__loading') }}</p>
        <div v-else-if="error" :class="$style.message" role="alert">
          <p>{{ error }}</p>
          <base-btn @click="load">{{ $t('list_trash__retry') }}</base-btn>
        </div>
        <p v-else-if="!entries.length" :class="$style.message">{{ $t('list_trash__none') }}</p>
        <ul v-else :class="$style.entries">
          <li v-for="entry in entries" :key="entry.id" :class="$style.entry" :data-trash-id="entry.id">
            <div :class="$style.info">
              <p :class="$style.title" :title="title(entry)">{{ title(entry) }}</p>
              <p>{{ $t(entry.kind === 'list' ? 'list_trash__playlist' : 'list_trash__songs', { count: entry.count, name: listName(entry) }) }}</p>
              <p>{{ $t('list_trash__deleted_at', { time: formatDate(entry.deletedAt) }) }}</p>
              <p>{{ $t('list_trash__remaining', { days: daysLeft(entry) }) }}</p>
            </div>
            <div :class="$style.actions">
              <base-btn :disabled="busy" @click="restore(entry)">{{ $t('list_trash__restore') }}</base-btn>
              <base-btn :disabled="busy" @click="removeEntries([entry])">{{ $t('list_trash__delete') }}</base-btn>
            </div>
          </li>
        </ul>
      </div>
      <footer :class="$style.footer">
        <base-btn :disabled="busy" @click="close">{{ $t('btn_close') }}</base-btn>
      </footer>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from '@common/utils/vueTools'
import { LIST_IDS } from '@common/constants'
import { LIST_TRASH_RETENTION_DAYS } from '@common/listTrash'
import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import { rendererOn, rendererOff } from '@common/rendererIpc'
import { getListTrash, restoreListTrash, deleteListTrash } from '@renderer/store/list/recycleBin'
import { useI18n } from '@renderer/plugins/i18n'
import { dialog } from '@renderer/plugins/Dialog'
import toast from '@renderer/plugins/Toast'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<(event: 'update:visible', value: boolean) => void>()
const t = useI18n()
const retentionDays = LIST_TRASH_RETENTION_DAYS
const entries = ref<LX.List.TrashEntry[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
let revision = 0
let refreshTimer: ReturnType<typeof setInterval> | undefined
const close = () => { if (!busy.value) emit('update:visible', false) }
const listName = (entry: LX.List.TrashEntry) => entry.listId === LIST_IDS.DEFAULT ? t('list__name_default') : entry.listId === LIST_IDS.LOVE ? t('list__name_love') : entry.listName
const title = (entry: LX.List.TrashEntry) => entry.kind === 'list' ? listName(entry) : entry.count === 1 ? entry.songName : t('list_trash__song_group', { name: entry.songName, count: entry.count })
const formatDate = (time: number) => new Date(time).toLocaleString(window.i18n.locale)
const daysLeft = (entry: LX.List.TrashEntry) => Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 86400000))
const load = async() => {
  const current = ++revision
  loading.value = true
  error.value = ''
  try {
    const result = await getListTrash()
    if (current === revision) entries.value = result
  } catch {
    if (current === revision) error.value = t('list_trash__load_error')
  } finally {
    if (current === revision) loading.value = false
  }
}
const restore = async(entry: LX.List.TrashEntry) => {
  if (busy.value) return
  busy.value = true
  try {
    await restoreListTrash([entry])
    await load()
  } catch { toast(t('list_trash__restore_error')) } finally { busy.value = false }
}
const removeEntries = async(selected: LX.List.TrashEntry[]) => {
  if (busy.value || !selected.length) return
  const targets = [...selected]
  busy.value = true
  try {
    if (!await dialog.confirm({
      message: t('list_trash__delete_confirm', { count: targets.length }),
      confirmButtonText: t('list_trash__delete'),
    })) return
    await deleteListTrash(targets)
    await load()
  } catch { toast(t('list_trash__operation_error')) } finally { busy.value = false }
}
const onChanged = () => { if (props.visible) void load() }
rendererOn(PLAYER_EVENT_NAME.list_trash_changed, onChanged)
watch(() => props.visible, visible => {
  clearInterval(refreshTimer)
  if (!visible) return
  void load()
  refreshTimer = setInterval(onChanged, 60000)
}, { immediate: true })
onBeforeUnmount(() => {
  revision++
  clearInterval(refreshTimer)
  rendererOff(PLAYER_EVENT_NAME.list_trash_changed, onChanged)
})
</script>

<style lang="less" module>
.main { display: flex; flex-direction: column; min-height: 0; padding: 24px; gap: 16px; }
.header {
  padding-right: 20px;
  h2 { font-size: 18px; line-height: 1.5; margin-bottom: 8px; }
  p { color: var(--color-font-label); font-size: 13px; line-height: 1.6; }
}
.toolbar, .footer { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; }
.footer { justify-content: flex-end; }
.content { min-height: 120px; min-width: 0; overflow-y: auto; }
.message { padding: 32px 0; text-align: center; line-height: 1.6; font-size: 14px; p { margin-bottom: 12px; } }
.entries { display: flex; flex-direction: column; }
.entry { display: flex; align-items: center; gap: 20px; padding: 16px 4px; border-bottom: 1px solid var(--color-border); &:last-child { border-bottom: none; } }
.info { flex: 1; min-width: 0; p { line-height: 1.6; font-size: 12px; color: var(--color-font-label); overflow-wrap: anywhere; } .title { font-size: 14px; color: var(--color-font); font-weight: 600; margin-bottom: 6px; } }
.actions { display: flex; flex: none; gap: 8px; }
@media (max-width: 640px) {
  .main { padding: 20px 16px; }
  .entry { flex-direction: column; align-items: stretch; gap: 12px; }
  .actions { justify-content: flex-end; }
}
</style>
