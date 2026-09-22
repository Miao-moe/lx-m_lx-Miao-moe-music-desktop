<template lang="pug">
dt#download {{ $t('setting__download') }}
dd
  .gap-top
    base-checkbox(id="setting_download_enable" :model-value="appSetting['download.enable']" :label="$t('setting__download_enable')" @update:model-value="updateSetting({'download.enable': $event})")
  .gap-top
    base-checkbox(id="setting_download_skip_exist_file" :model-value="appSetting['download.skipExistFile']" :label="$t('setting__download_skip_exist_file')" @update:model-value="updateSetting({'download.skipExistFile': $event})")
  .gap-top
    base-checkbox(id="setting_download_save_group_list_name" :model-value="appSetting['download.isSavePathGroupByListName']" :label="$t('setting_download_save_group_list_name')" @update:model-value="updateSetting({'download.isSavePathGroupByListName': $event})")
dd(:aria-label="$t('setting__download_path_title')")
  h3#download_path {{ $t('setting__download_path') }}
  div
    .p
      | {{ $t('setting__download_path_label') }}
      span.auto-hidden.hover(:class="$style.savePath" :aria-label="$t('setting__download_path_open_label')" @click="openDirInExplorer(appSetting['download.savePath'])") {{ appSetting['download.savePath'] }}
    .p
      base-btn.btn(min @click="handleChangeSavePath") {{ $t('setting__download_path_change_btn') }}

dd
  h3#download_max_num
    | {{ $t('setting__download_max_num') }}
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__download_max_num_tooltip')")
  div
    p
      base-selection.gap-left(:class="$style.selectWidth" :model-value="appSetting['download.maxDownloadNum']" :list="maxNums" item-key="id" item-name="id" @change="handleUpdateMaxNum")

dd
  h3 {{ $t('setting__download_rate_limit') }}
  base-selection(:model-value="appSetting['download.rateLimit']" :list="rateLimits" item-key="id" item-name="name" @change="handleRateLimit")
  .gap-top
    base-checkbox(id="setting_download_auto_resume" :model-value="appSetting['download.autoResume']" :label="$t('setting__download_auto_resume')" @update:model-value="updateSetting({'download.autoResume': $event})")

dd
  h3#download_use_other_source
    | {{ $t('setting__download_use_other_source') }}
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__download_use_other_source_tip')")
  div
    base-checkbox(id="setting_download_isUseOtherSource" :model-value="appSetting['download.isUseOtherSource']" :label="$t('setting__is_enable')" @update:model-value="updateSetting({'download.isUseOtherSource': $event})")
  div
dd(:aria-label="$t('setting__download_name_title')")
  h3#download_name {{ $t('setting__download_name') }}
  div.setting-options
    base-checkbox.gap-left(
        v-for="item in musicNames" :id="`setting_download_musicName_${item.value}`" :key="item.value" name="setting_download_musicName" :value="item.value"
        need :model-value="appSetting['download.fileName']" :label="item.name" @update:model-value="updateSetting({'download.fileName': $event})")
  .gap-top
    base-input(id="setting_download_name_template" :class="$style.nameTemplate" :model-value="appSetting['download.fileName']" :aria-label="$t('setting__download_name_template')" :trim="false" :auto-paste="false" @change="updateSetting({'download.fileName': $event || '歌名 - 歌手'})")
  p {{ $t('setting__download_name_fields') }}
  p(data-download-name-preview) {{ $t('setting__download_name_preview') }}{{ namePreview }}
  p {{ $t('setting__download_collision_rule') }}
dd
  h3#download_data_embed {{ $t('setting__download_data_embed') }}
  .gap-top
    base-checkbox(id="setting_download_isEmbedPic" :model-value="appSetting['download.isEmbedPic']" :label="$t('setting__download_embed_pic')" @update:model-value="updateSetting({'download.isEmbedPic': $event})")
  .gap-top
    base-checkbox(id="setting_download_isEmbedLyric" :model-value="appSetting['download.isEmbedLyric']" :label="$t('setting__download_embed_lyric')" @update:model-value="updateSetting({'download.isEmbedLyric': $event})")
  common-setting-reveal(:show="appSetting['download.isEmbedLyric']" depends="setting_download_isEmbedLyric")
    .gap-top
      base-checkbox(id="setting_download_isEmbedLyricT" :model-value="appSetting['download.isEmbedLyricT']" :label="$t('setting__download_embed_tlyric')" @update:model-value="updateSetting({'download.isEmbedLyricT': $event})")
    .gap-top
      base-checkbox(id="setting_download_isEmbedLyricR" :model-value="appSetting['download.isEmbedLyricR']" :label="$t('setting__download_embed_rlyric')" @update:model-value="updateSetting({'download.isEmbedLyricR': $event})")
    .gap-top
      base-checkbox(id="setting_download_isEmbedLyricLx" :model-value="appSetting['download.isEmbedLyricLx']" :label="$t('setting__download_embed_lxlyric')" @update:model-value="updateSetting({'download.isEmbedLyricLx': $event})")
dd(:aria-label="$t('setting__download_lyric_title')")
  h3#download_lyric {{ $t('setting__download_lyric') }}
  .gap-top
    base-checkbox(id="setting_download_isDownloadLrc" :model-value="appSetting['download.isDownloadLrc']" :label="$t('setting__is_enable')" @update:model-value="updateSetting({'download.isDownloadLrc': $event})")
  common-setting-reveal(:show="appSetting['download.isDownloadLrc']" depends="setting_download_isDownloadLrc")
    .gap-top
      base-checkbox(id="setting_download_isDownloadTLrc" :model-value="appSetting['download.isDownloadTLrc']" :label="$t('setting__download_tlyric')" @update:model-value="updateSetting({'download.isDownloadTLrc': $event})")
    .gap-top
      base-checkbox(id="setting_download_isDownloadRLrc" :model-value="appSetting['download.isDownloadRLrc']" :label="$t('setting__download_rlyric')" @update:model-value="updateSetting({'download.isDownloadRLrc': $event})")
    .gap-top
      base-checkbox(id="setting_download_isDownloadLxLrc" :model-value="appSetting['download.isDownloadLxLrc']" :label="$t('setting__download_lxlyric')" @update:model-value="updateSetting({'download.isDownloadLxLrc': $event})")
common-setting-reveal(tag="dd" :show="appSetting['download.isDownloadLrc']" depends="setting_download_isDownloadLrc")
  h3#download_lyric_format
    | {{ $t('setting__download_lyric_format') }}
    svg-icon(class="help-icon" name="help-circle-outline" :aria-label="$t('setting__download_lyric_format_tip')")
  div.setting-options
    base-checkbox.gap-left(
      v-for="item in lrcFormatList" :id="`setting_download_lrcFormat_${item.id}`" :key="item.id"
      name="setting_download_lrcFormat" need :model-value="appSetting['download.lrcFormat']" :value="item.id" :label="item.name"
      @update:model-value="updateSetting({'download.lrcFormat': $event})")
</template>

<script>
import { computed } from '@common/utils/vueTools'
// import { getSystemFonts } from '@renderer/utils/tools'
import { showSelectDialog, openDirInExplorer } from '@renderer/utils/ipc'
import { useI18n } from '@renderer/plugins/i18n'
import { appSetting, updateSetting } from '@renderer/store/setting'
import { dialog } from '@renderer/plugins/Dialog'
import { formatDownloadFileName } from '@common/utils/download/fileName'
import { setDownloadRateLimit } from '@renderer/store/download/action'

export default {
  name: 'SettingDownload',
  setup() {
    const t = useI18n()

    const handleChangeSavePath = () => {
      void showSelectDialog({
        title: t('setting__download_select_save_path'),
        defaultPath: appSetting['download.savePath'],
        properties: ['openDirectory'],
      }).then(result => {
        if (result.canceled) return
        updateSetting({ 'download.savePath': result.filePaths[0] })
      })
    }

    const maxNums = new Array(6).fill(null).map((_, i) => ({ id: i + 1 }))
    const rateLimits = computed(() => [0, 128, 256, 512, 1024, 2048, 5120].map(id => ({ id, name: id ? id + ' KiB/s' : t('setting__download_unlimited') })))
    const handleRateLimit = ({ id }) => {
      updateSetting({ 'download.rateLimit': id })
      void setDownloadRateLimit(id).catch(console.error)
    }
    const namePreview = computed(() => formatDownloadFileName(appSetting['download.fileName'], {
      id: 'kw_12345', source: 'kw', name: t('setting__download_preview_title'), singer: t('setting__download_preview_artist'), meta: { albumName: t('setting__download_preview_album') },
    }, '320k', 'mp3'))
    const handleUpdateMaxNum = async({ id }) => {
      if (id > 3) {
        if (!await dialog.confirm(window.i18n.t('setting__download_max_num_tip'))) return
      }
      updateSetting({ 'download.maxDownloadNum': id })
    }

    const musicNames = computed(() => {
      return [
        { value: '歌名 - 歌手', name: t('setting__download_name1') },
        { value: '歌手 - 歌名', name: t('setting__download_name2') },
        { value: '歌名', name: t('setting__download_name3') },
      ]
    })

    const lrcFormatList = computed(() => {
      return [
        { id: 'utf8', name: t('setting__download_lyric_format_utf8') },
        { id: 'gbk', name: t('setting__download_lyric_format_gbk') },
      ]
    })

    return {
      appSetting,
      updateSetting,
      openDirInExplorer,
      handleChangeSavePath,
      musicNames,
      lrcFormatList,
      maxNums,
      rateLimits,
      handleRateLimit,
      namePreview,
      handleUpdateMaxNum,
    }
  },
}
</script>

<style lang="less" module>
// .savePath {
//   font-size: 12px;
// }
.selectWidth {
  width: 60px;
}
.nameTemplate {
  width: 360px;
  max-width: 100%;
  box-sizing: border-box;
}
</style>
