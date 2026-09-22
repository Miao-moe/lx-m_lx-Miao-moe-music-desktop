<template>
  <material-modal :show="show" :bg-close="!saving" max-width="420px" @close="close">
    <form :class="$style.content" @submit.prevent="save">
      <h2>{{ $t('player__queue_save') }}</h2>
      <base-input v-model="name" :aria-label="$t('lists__new_list_input')" :placeholder="$t('lists__new_list_input')" :disabled="saving" />
      <p v-if="error" role="alert">{{ $t('player__queue_save_error') }}</p>
      <div :class="$style.actions">
        <base-btn type="button" :disabled="saving" @click="close">{{ $t('btn_cancel') }}</base-btn>
        <base-btn type="submit" :disabled="saving || !name.trim() || !list.length">{{ $t('btn_save') }}</base-btn>
      </div>
    </form>
  </material-modal>
</template>

<script setup>
import { ref, watch, toRaw } from '@common/utils/vueTools'
import { createUserList, removeUserList } from '@renderer/store/list/action'
import showToast from '@renderer/plugins/Toast'

const props = defineProps({ show: Boolean, list: { type: Array, required: true } })
const emit = defineEmits(['update:show'])
const name = ref('')
const saving = ref(false)
const error = ref(false)
watch(() => props.show, show => { if (show) { name.value = ''; error.value = false } })
const close = () => { if (!saving.value) emit('update:show', false) }
const save = async() => {
  if (saving.value || !name.value.trim() || !props.list.length) return
  saving.value = true
  error.value = false
  const id = `userlist_queue_${Date.now()}`
  // Playlists have unique song IDs; retain the first occurrence in queue order.
  const seen = new Set()
  const list = props.list.filter(song => !seen.has(song.id) && seen.add(song.id)).map(toRaw)
  try {
    await createUserList({ id, name: name.value.trim(), list })
    emit('update:show', false)
    showToast(window.i18n.t('player__queue_saved'))
  } catch {
    error.value = true
    await removeUserList([id]).catch(console.error)
  } finally { saving.value = false }
}
</script>

<style lang="less" module>
.content { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.actions { display: flex; justify-content: flex-end; gap: 12px; }
</style>
