<template>
  <material-modal :show="visible" bg-close teleport="#view" @close="close">
    <section :class="$style.panel" data-playlist-tags-modal>
      <h2>{{ $t('lists__edit_tags') }}</h2>
      <p :class="$style.listName">{{ listInfo?.name }}</p>
      <label :class="$style.label" for="playlist_tags_input">{{ $t('lists__tags') }}</label>
      <base-input
        id="playlist_tags_input" v-model="tags" :class="$style.input" :disabled="busy"
        :placeholder="$t('lists__tags_placeholder')" :trim="false" maxlength="1600"
        @submit="save"
      />
      <p :class="$style.tip">{{ $t('lists__tags_tip') }}</p>
      <p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
      <div :class="$style.actions">
        <base-btn :disabled="busy" @click="close">{{ $t('btn_cancel') }}</base-btn>
        <base-btn :disabled="busy || !listInfo" @click="save">{{ $t('btn_confirm') }}</base-btn>
      </div>
    </section>
  </material-modal>
</template>

<script setup lang="ts">
import { ref, watch } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
import { useI18n } from '@renderer/plugins/i18n'
import { libraryPreferences, refreshLibraryPreferences, saveLibraryPreferences } from '@renderer/utils/library'

const props = defineProps<{ visible: boolean, listInfo: LX.List.UserListInfo | null }>()
const emit = defineEmits<{ 'update:visible': [visible: boolean] }>()
const t = useI18n()
const tags = ref('')
const busy = ref(false)
const error = ref('')
let generation = 0

const close = () => { if (!busy.value) emit('update:visible', false) }
const load = async() => {
  const current = ++generation
  if (!props.visible || !props.listInfo) { busy.value = false; return }
  busy.value = true
  error.value = ''
  try {
    await refreshLibraryPreferences()
    if (current === generation) tags.value = libraryPreferences.value.lists[props.listInfo.id]?.tags.join(', ') ?? ''
  } catch (cause) {
    if (current === generation) error.value = formatError(cause, t('lists__tags_load_failed'), 'PLAYLIST_TAGS_LOAD_FAILED')
  } finally {
    if (current === generation) busy.value = false
  }
}
watch(() => [props.visible, props.listInfo?.id], () => { void load() }, { immediate: true })

const save = async() => {
  const listId = props.listInfo?.id
  if (!listId || busy.value) return
  const parsed = [...new Set(tags.value.split(/[,，、\n]/).map(tag => tag.trim()).filter(Boolean))]
  if (parsed.length > 20 || parsed.some(tag => tag.length > 80)) {
    error.value = t('lists__tags_limit')
    return
  }
  busy.value = true
  error.value = ''
  try {
    await refreshLibraryPreferences()
    const prefs = JSON.parse(JSON.stringify(libraryPreferences.value)) as typeof libraryPreferences.value
    const previous = prefs.lists[listId] ?? { folder: '', tags: [], pinned: false }
    prefs.lists[listId] = { ...previous, tags: parsed }
    await saveLibraryPreferences(prefs)
    emit('update:visible', false)
  } catch (cause) {
    error.value = formatError(cause, t('lists__tags_save_failed'), 'PLAYLIST_TAGS_SAVE_FAILED')
  } finally {
    busy.value = false
  }
}
</script>

<style lang="less" module>
.panel { padding: 20px; min-width: 300px; max-width: 480px; display: flex; flex-direction: column; gap: 10px; color: var(--color-font); }
.panel h2 { font-size: 18px; }
.listName { color: var(--color-font-label); overflow-wrap: anywhere; }
.label { font-size: 13px; }
.input { width: 100%; box-sizing: border-box; }
.tip { color: var(--color-font-label); font-size: 12px; }
.error { color: var(--color-danger); white-space: pre-wrap; font-size: 12px; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }
</style>
