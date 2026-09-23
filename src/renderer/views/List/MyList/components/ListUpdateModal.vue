<template>
  <material-modal :show="visible" bg-close teleport="#view" @close="$emit('update:visible', false)">
    <div :class="$style.header">
      <h2>{{ $t('list_update_modal__title') }}</h2>
      <nav :class="$style.tabs" :aria-label="$t('list_update_modal__title')">
        <base-btn min :class="{ [$style.activeTab]: activeTab === 'updates' }" :aria-pressed="activeTab === 'updates'" @click="activeTab = 'updates'">{{ $t('list_update_modal__imported') }}</base-btn>
        <base-btn min :class="{ [$style.activeTab]: activeTab === 'selection' }" :aria-pressed="activeTab === 'selection'" @click="activeTab = 'selection'">{{ $t('list_update_modal__selection') }}</base-btn>
      </nav>
    </div>
    <main class="scroll" :class="$style.main">
      <transition name="list-update-view" mode="out-in">
      <div v-if="activeTab === 'updates'">
      <ul v-if="lists.length" ref="dom_list" :class="$style.list">
        <li v-for="list in lists" :key="list.id" :class="[$style.listItem, {[$style.fetching]: fetchingListStatus[list.id]}]">
          <div :class="$style.listLeft">
            <h3 :class="$style.text">{{ list.name }} <span :class="$style.label">{{ list.source }}</span></h3>
            <div>
              <base-checkbox
                :id="`list_auto_update_${list.id}`" :model-value="updateInfo[list.id]?.isAutoUpdate == true"
                :class="$style.checkbox" :label="$t('list_update_modal__auto_update')" @change="handleChangeAutoUpdate(list, $event)"
              />
              <span :class="$style.label" style="vertical-align: text-top;">{{ listUpdateTimes[list.id] }}</span>
            </div>
            <div :class="$style.writeback">
              <base-checkbox
                :id="`list_writeback_${list.id}`" controlled :model-value="writebackStatus[list.id]?.enabled === true"
                :disabled="!isWritebackSupported(list) || changing[list.id] === true || fetchingListStatus[list.id]"
                :class="$style.checkbox" :label="$t('list_writeback__enable')" @change="handleWriteback(list, $event)"
              />
              <span v-if="!isWritebackSupported(list)" :class="$style.status">{{ $t('list_writeback__unsupported') }}</span>
              <span v-else-if="changing[list.id]" :class="$style.status" role="status">{{ $t('list_writeback__checking') }}</span>
              <span v-else-if="writebackStatus[list.id]?.enabled" :class="$style.status" role="status">
                {{ $t(`list_writeback__${writebackStatus[list.id].state}`) }}
                <span v-if="writebackStatus[list.id].ignored"> · {{ $t('list_writeback__ignored', { count: writebackStatus[list.id].ignored }) }}</span>
              </span>
            </div>
            <p v-if="errors[list.id] || writebackStatus[list.id]?.error" :class="$style.error" role="status">
              {{ formatError({ code: 'WRITEBACK_' + (errors[list.id] || writebackStatus[list.id].error).toUpperCase(), message: $t(`list_writeback__error_${errors[list.id] || writebackStatus[list.id].error}`) }) }}
            </p>
            <SyncDiffPanel :diff="writebackStatus[list.id]?.diff?.local" :title="$t('list_writeback__diff_local')" />
            <SyncDiffPanel :diff="writebackStatus[list.id]?.diff?.remote" :title="$t('list_writeback__diff_remote')" />
            <p v-if="writebackStatus[list.id]?.enabled" :class="$style.status">
              {{ $t(`list_writeback__scope_${list.source}`) }}
            </p>
          </div>
          <div :class="$style.btns">
            <base-btn v-if="writebackStatus[list.id]?.enabled" min :disabled="writebackStatus[list.id].state === 'syncing' || changing[list.id]" @click="handleRetry(list)">
              {{ $t('list_writeback__retry') }}
            </base-btn>
            <button :class="$style.btn" :disabled="fetchingListStatus[list.id]" outline="outline" :aria-label="$t('list_update_modal__update')" @click.stop="handleUpdate(list)">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" xlink="http://www.w3.org/1999/xlink" style="transform: rotate(45deg);" viewBox="0 0 24 24" space="preserve">
                <use xlink:href="#icon-refresh" />
              </svg>
            </button>
          </div>
        </li>
      </ul>
      <div v-else :class="$style.noItem">
        <p v-text="$t('no_item')" />
      </div>
      </div>
      <PlatformSyncSelection v-else />
      </transition>
    </main>
    <div v-if="activeTab === 'updates'" :class="$style.footer">
      <div :class="$style.tips">{{ $t('list_update_modal__tips') }}</div>
      <div :class="$style.tips">{{ $t('list_writeback__tips') }}</div>
    </div>
  </material-modal>
</template>

<script>
import { computed, ref, reactive } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
import SyncDiffPanel from '@renderer/components/common/SyncDiffPanel.vue'
import PlatformSyncSelection from './PlatformSyncSelection.vue'
import { userLists, fetchingListStatus, listUpdateTimes } from '@renderer/store/list/state'
import handleSyncSourceList from '@renderer/store/list/syncSourceList'
import musicSdk from '@renderer/utils/musicSdk'
// import { dateFormat } from '@common/utils/renderer'
import { getListUpdateInfo, setListAutoUpdate } from '@renderer/utils/data'
import { isWritebackSupported, setPlaylistWriteback, retryPlaylistWriteback, writebackStatus, WritebackError } from '@renderer/utils/playlistWriteback'

export default {
  components: { SyncDiffPanel, PlatformSyncSelection },
  props: {
    visible: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['update:visible'],
  setup() {
    const activeTab = ref('updates')
    const lists = computed(() => userLists.filter(l => !!l.source && !!musicSdk[l.source]?.songList))
    const updateInfo = ref({})
    const changing = reactive({})
    const errors = reactive({})
    // const updateTimes = ref({})

    void getListUpdateInfo().then((listUpdateInfo) => {
      updateInfo.value = listUpdateInfo
      // if (listUpdateTimes._inited) {
      //   for (const [id, value] of Object.entries(info)) {
      //     autoUpdate[id] = value.isAutoUpdate == true
      //   }
      // } else {
      //   for (const [id, value] of Object.entries(info)) {
      //     autoUpdate[id] = value.isAutoUpdate == true
      //     listUpdateTimes[id] = value.updateTime ? dateFormat(value.updateTime) : ''
      //   }
      // }
      // listUpdateTimes._inited = true
    })

    const handleUpdate = async(targetListInfo) => {
      errors[targetListInfo.id] = undefined
      try { await handleSyncSourceList(targetListInfo) } catch (error) {
        errors[targetListInfo.id] = error instanceof WritebackError ? error.code : 'failed'
      }
    }
    const handleWriteback = async(list, enabled) => {
      if (changing[list.id]) return
      changing[list.id] = true
      errors[list.id] = undefined
      try { await setPlaylistWriteback(list.id, enabled) } catch (error) {
        errors[list.id] = error instanceof WritebackError ? error.code : 'failed'
      } finally { changing[list.id] = false }
    }
    const handleRetry = async(list) => {
      errors[list.id] = undefined
      try { await retryPlaylistWriteback(list.id) } catch {
        errors[list.id] = 'storage'
      }
    }

    const handleChangeAutoUpdate = (list, enable) => {
      void setListAutoUpdate(list.id, enable)
    }

    return {
      activeTab,
      formatError,
      lists,
      updateInfo,
      fetchingListStatus,
      handleUpdate,
      handleChangeAutoUpdate,
      listUpdateTimes,
      changing,
      errors,
      writebackStatus,
      isWritebackSupported,
      handleWriteback,
      handleRetry,
    }
  },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

@width: min(620px, calc(100vw - 80px));

.header {
  flex: none;
  padding: 15px;
  text-align: center;
  h2 {
    word-break: break-all;
  }
}
.tabs {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  justify-content: center;
  flex-wrap: wrap;
}
.activeTab { color: var(--color-primary); background-color: var(--color-selected); }
:global(.list-update-view-enter-active), :global(.list-update-view-leave-active) { transition: opacity var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard); }
:global(.list-update-view-enter-from), :global(.list-update-view-leave-to) { opacity: 0; transform: translateY(5px); }
.main {
  min-height: 115px;
  width: @width;
}

.list {
  // background-color: @color-search-form-background;
  font-size: 13px;
  transition-property: height;
  position: relative;
  .listItem {
    position: relative;
    padding: 15px 10px 15px 15px;
    transition: .3s ease;
    transition-property: background-color, opacity;
    line-height: 1.3;
    // overflow: hidden;
    display: flex;
    flex-flow: row nowrap;
    align-items: center;

    &:hover {
      background-color: var(--color-primary-background-hover);
    }
    // border-radius: 4px;
    // &:last-child {
    //   border-bottom-left-radius: 4px;
    //   border-bottom-right-radius: 4px;
    // }
    &.fetching {
      opacity: .5;
    }
  }
}

.listLeft {
  flex: auto;
  min-width: 0;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
}

.text {
  flex: auto;
  margin-bottom: 2px;
  .mixin-ellipsis-1();
}
.checkbox {
  margin-top: 3px;
  font-size: 14px;
  opacity: .86;
}

.label {
  flex: none;
  font-size: 12px;
  opacity: 0.5;
  padding: 0 10px;
  // display: flex;
  // align-items: center;
  // transform: rotate(45deg);
  // background-color:
}
.btns {
  flex: none;
  font-size: 12px;
  padding: 0 5px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.writeback {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.status, .error {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-font-label);
}
.error {
  color: var(--color-primary);
}
.btn {
  background-color: transparent;
  border: none;
  border-radius: @form-radius;
  margin-right: 5px;
  cursor: pointer;
  padding: 4px 7px;
  color: var(--color-button-font);
  outline: none;
  transition: background-color 0.2s ease;
  line-height: 0;
  &:last-child {
    margin-right: 0;
  }

  svg {
    height: 22px;
    width: 22px;
  }

  &:hover {
    background-color: var(--color-primary-background-hover);
  }
  &:active {
    background-color: var(--color-primary-font-active);
  }
}

.footer {
  width: @width;
}
.tips {
  padding: 8px 15px;
  font-size: 13px;
  line-height: 1.25;
  color: var(--color-font);
}

.noItem {
  position: relative;
  height: 200px;
  display: flex;
  flex-flow: column nowrap;
  justify-content: center;
  align-items: center;

  p {
    font-size: 16px;
    color: var(--color-font-label);
  }
}

</style>
