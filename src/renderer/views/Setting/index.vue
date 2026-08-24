<template>
  <div :class="$style.main">
    <div class="scroll" :class="$style.toc">
      <div :class="$style.searchBox">
        <svg :class="$style.searchIcon" viewBox="0 0 30.239 30.239" aria-hidden="true">
          <use xlink:href="#icon-search" />
        </svg>
        <base-input
          ref="dom_filter_input" v-model="settingFilter" :class="$style.searchInput"
          :trim="false" :placeholder="$t('setting__filter_placeholder')" :aria-label="$t('setting__filter_placeholder')"
          @keydown.esc="clearSettingFilter"
        />
        <button
          v-if="settingFilter" type="button" :class="$style.clearSearchBtn"
          :aria-label="$t('close')" @click="clearSettingFilter"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <use xlink:href="#icon-window-close" />
          </svg>
        </button>
      </div>
      <ul v-if="visibleTocList.length" :class="$style.tocList" role="toolbar">
        <li v-for="h2 in visibleTocList" :key="h2.id" :class="$style.tocListItem" role="presentation">
          <h2
            :class="[$style.tocH2, {[$style.active]: avtiveComponentName == h2.id }]"
            role="tab" :aria-selected="avtiveComponentName == h2.id"
            :aria-label="h2.title" ignore-tip @click="toggleTab(h2.id)"
          >
            <transition name="list-active">
              <svg-icon v-if="avtiveComponentName == h2.id" name="angle-right-solid" :class="$style.activeIcon" />
            </transition>
            {{ h2.title }}
          </h2>
          <!-- <ul v-if="h2.children.length" :class="$style.tocList">
            <li v-for="h3 in h2.children" :key="h3.id" :class="$style.tocSubListItem">
              <h3 :class="[$style.tocH3, toc.activeId == h3.id ? $style.active : null]" :aria-label="h3.title">
                <a :href="'#' + h3.id" @click.stop="toc.activeId = h3.id">{{ h3.title }}</a>
              </h3>
            </li>
          </ul> -->
        </li>
      </ul>
      <p v-else :class="$style.searchEmpty">{{ $t('setting__filter_empty') }}</p>
    </div>
    <div ref="dom_content_ref" class="scroll" :class="[$style.setting, {[$style.searchFiltering]: isFiltering}]">
      <p v-if="isFiltering && !visibleTocList.length" :class="$style.contentEmpty">{{ $t('setting__filter_empty') }}</p>
      <dl v-show="visibleTocList.length">
        <component :is="avtiveComponentName" />
        <!-- <SettingBasic />
        <SettingPlay />
        <SettingPlayDetail />
        <SettingDesktopLyric />
        <SettingSearch />
        <SettingList />
        <SettingDownload />
        <SettingSync />
        <SettingHotKey />
        <SettingNetwork />
        <SettingOdc />
        <SettingBackup />
        <SettingOther />
        <SettingUpdate />
        <SettingAbout /> -->
      </dl>
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from '@common/utils/vueTools'
// import { currentStting } from './setting'
import { useI18n } from '@renderer/plugins/i18n'
import { useRoute } from '@common/utils/vueRouter'

import SettingBasic from './components/SettingBasic.vue'
import SettingPlay from './components/SettingPlay.vue'
import SettingPlayDetail from './components/SettingPlayDetail.vue'
import SettingDesktopLyric from './components/SettingDesktopLyric.vue'
import SettingSearch from './components/SettingSearch.vue'
import SettingList from './components/SettingList.vue'
import SettingDownload from './components/SettingDownload.vue'
import SettingSync from './components/SettingSync/index.vue'
import SettingOpenAPI from './components/SettingOpenAPI.vue'
import SettingHotKey from './components/SettingHotKey.vue'
import SettingNetwork from './components/SettingNetwork.vue'
import SettingCookie from './components/SettingCookie.vue'
import SettingAdvanced from './components/SettingAdvanced.vue'
import SettingOdc from './components/SettingOdc.vue'
import SettingBackup from './components/SettingBackup.vue'
import SettingOther from './components/SettingOther.vue'
import SettingUpdate from './components/SettingUpdate.vue'
import SettingAbout from './components/SettingAbout.vue'

export default {
  name: 'Setting',
  components: {
    SettingBasic,
    SettingPlay,
    SettingPlayDetail,
    SettingDesktopLyric,
    SettingSearch,
    SettingList,
    SettingDownload,
    SettingSync,
    SettingOpenAPI,
    SettingHotKey,
    SettingNetwork,
    SettingCookie,
    SettingAdvanced,
    SettingOdc,
    SettingBackup,
    SettingOther,
    SettingUpdate,
    SettingAbout,
  },
  setup() {
    const t = useI18n()
    const route = useRoute()

    const dom_content_ref = ref(null)
    const dom_filter_input = ref(null)
    const settingFilter = ref('')

    const tocList = computed(() => {
      return [
        { id: 'SettingBasic', title: t('setting__basic'), prefixes: ['setting__basic', 'theme'], keys: ['setting__play_timeout'] },
        { id: 'SettingPlay', title: t('setting__play'), prefixes: ['setting__play', 'setting__player'], excludes: ['setting__play_detail', 'setting__play_timeout'] },
        { id: 'SettingPlayDetail', title: t('setting__play_detail'), prefixes: ['setting__play_detail'] },
        { id: 'SettingDesktopLyric', title: t('setting__desktop_lyric'), prefixes: ['setting__desktop_lyric'] },
        { id: 'SettingSearch', title: t('setting__search'), prefixes: ['setting__search'] },
        { id: 'SettingList', title: t('setting__list'), prefixes: ['setting__list'] },
        { id: 'SettingDownload', title: t('setting__download'), prefixes: ['setting__download'] },
        { id: 'SettingHotKey', title: t('setting__hot_key'), prefixes: ['setting__hot_key'] },
        { id: 'SettingSync', title: t('setting__sync'), prefixes: ['setting__sync'] },
        { id: 'SettingOpenAPI', title: t('setting__open_api'), prefixes: ['setting__open_api'] },
        { id: 'SettingNetwork', title: t('setting__network'), prefixes: ['setting__network'] },
        { id: 'SettingCookie', title: t('setting__cookie'), prefixes: ['setting__cookie'] },
        { id: 'SettingAdvanced', title: t('setting__advanced'), prefixes: ['setting__advanced'] },
        { id: 'SettingOdc', title: t('setting__odc'), prefixes: ['setting__odc'] },
        { id: 'SettingBackup', title: t('setting__backup'), prefixes: ['setting__backup'] },
        { id: 'SettingOther', title: t('setting__other'), prefixes: ['setting__other'] },
        { id: 'SettingUpdate', title: t('setting__update'), prefixes: ['setting__update'] },
        { id: 'SettingAbout', title: t('setting__about'), prefixes: ['setting__about'] },
      ]
    })

    const normalizeSearchText = text => String(text).replace(/\s+/g, ' ').trim().toLocaleLowerCase()
    const isFiltering = computed(() => !!normalizeSearchText(settingFilter.value))
    const matchedGroupIds = computed(() => {
      const keyword = normalizeSearchText(settingFilter.value)
      const ids = new Set()
      if (!keyword) return ids

      const messages = Object.entries(window.i18n.message)
      for (const group of tocList.value) {
        for (const [key, value] of messages) {
          const matchesPrefix = group.prefixes.some(prefix => key == prefix || key.startsWith(`${prefix}_`)) || group.keys?.includes(key)
          const isExcluded = group.excludes?.some(prefix => key == prefix || key.startsWith(`${prefix}_`))
          if (!matchesPrefix || isExcluded) continue
          if (!normalizeSearchText(value).includes(keyword)) continue
          ids.add(group.id)
          break
        }
      }
      return ids
    })
    const visibleTocList = computed(() => {
      if (!isFiltering.value) return tocList.value
      return tocList.value.filter(group => matchedGroupIds.value.has(group.id))
    })

    const avtiveComponentName = ref(route.query.name && tocList.value.some(t => t.id == route.query.name)
      ? route.query.name
      : tocList.value[0].id)

    const clearSettingFilterState = () => {
      dom_content_ref.value?.querySelectorAll('.setting-search-visible').forEach(element => {
        element.classList.remove('setting-search-visible')
      })
    }
    const markSearchBranch = (element) => {
      if (!element) return
      element.classList.add('setting-search-visible')
      element.querySelectorAll('*').forEach(child => child.classList.add('setting-search-visible'))

      let parent = element.parentElement
      while (parent && parent !== dom_content_ref.value) {
        parent.classList.add('setting-search-visible')
        parent = parent.parentElement
      }
    }
    const applySettingFilter = () => {
      clearSettingFilterState()
      const keyword = normalizeSearchText(settingFilter.value)
      if (!keyword || !dom_content_ref.value) return

      const getElementText = element => normalizeSearchText(`${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`)
      const elements = [...dom_content_ref.value.querySelectorAll('dt, h3, h4, label, p, button, span, dd > div, [aria-label]')]
      const targets = elements.filter(element => {
        if (!getElementText(element).includes(keyword)) return false
        return ![...element.children].some(child => getElementText(child).includes(keyword))
      })

      const pageTitle = dom_content_ref.value.querySelector('dl > dt')
      markSearchBranch(pageTitle)
      if (targets.some(target => target.tagName == 'DT')) {
        markSearchBranch(pageTitle?.parentElement)
        return
      }

      for (const target of targets) {
        let itemRoot
        if (target.tagName == 'H3') {
          itemRoot = target.closest('dd')
        } else if (target.tagName == 'H4') {
          itemRoot = target.parentElement
        } else {
          const control = target.closest('label, button, p')
          itemRoot = control?.tagName == 'LABEL' ? control.parentElement : control ?? target
        }
        markSearchBranch(itemRoot)

        const section = itemRoot?.closest('dd')
        markSearchBranch(section?.querySelector(':scope > h3'))
      }
    }
    const toggleTab = (id) => {
      avtiveComponentName.value = id
      void nextTick(() => {
        applySettingFilter()
        dom_content_ref.value?.scrollTo({
          top: 0,
          behavior: 'smooth',
        })
      })
    }
    const clearSettingFilter = () => {
      settingFilter.value = ''
      clearSettingFilterState()
      void nextTick(() => dom_filter_input.value?.focus())
    }

    watch(visibleTocList, (list) => {
      if (isFiltering.value && list.length && !list.some(group => group.id == avtiveComponentName.value)) {
        avtiveComponentName.value = list[0].id
      }
      void nextTick(() => {
        applySettingFilter()
        dom_content_ref.value?.scrollTo({ top: 0, behavior: 'smooth' })
      })
    })

    // Alt + ← / Alt + → 切换上一个 / 下一个设置面板
    const goPrevPanel = () => {
      const ids = visibleTocList.value.map(i => i.id)
      const idx = ids.indexOf(avtiveComponentName.value)
      if (idx > 0) toggleTab(ids[idx - 1])
    }
    const goNextPanel = () => {
      const ids = visibleTocList.value.map(i => i.id)
      const idx = ids.indexOf(avtiveComponentName.value)
      if (idx < ids.length - 1) toggleTab(ids[idx + 1])
    }
    const handleKeydown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLocaleLowerCase() === 'f') {
        const target = e.target
        const isEditingControl = target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
        if (window.lx.isEditingHotKey || (isEditingControl && target !== dom_filter_input.value)) return
        e.preventDefault()
        dom_filter_input.value?.focus()
        return
      }
      if (!e.altKey) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrevPanel()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goNextPanel()
      }
    }
    onMounted(() => {
      window.addEventListener('keydown', handleKeydown)
    })
    onBeforeUnmount(() => {
      window.removeEventListener('keydown', handleKeydown)
      clearSettingFilterState()
    })

    return {
      visibleTocList,
      isFiltering,
      avtiveComponentName,
      dom_content_ref,
      dom_filter_input,
      settingFilter,
      toggleTab,
      clearSettingFilter,
    }
  },
  // mounted() {
  //   this.initTOC()
  // },
  // methods: {
  //   initTOC() {
  //     const list = this.$refs.dom_setting_list.children
  //     const toc = []
  //     let prevTitle
  //     for (const item of list) {
  //       if (item.tagName == 'DT') {
  //         prevTitle = {
  //           title: item.innerText.replace(/[（(].+?[)）]/, ''),
  //           id: item.getAttribute('id'),
  //           dom: item,
  //           children: [],
  //         }
  //         toc.push(prevTitle)
  //         continue
  //       }
  //       const h3 = item.querySelector('h3')
  //       if (h3) {
  //         prevTitle.children.push({
  //           title: h3.innerText.replace(/[（(].+?[)）]/, ''),
  //           id: h3.getAttribute('id'),
  //           dom: h3,
  //         })
  //       }
  //     }
  //     console.log(toc)
  //     this.toc.list = toc
  //   },
  //   handleListScroll(event) {
  //     // console.log(event.target.scrollTop)
  //   },
  // },
}
</script>

<style lang="less" module>
@import '@renderer/assets/styles/layout.less';

.main {
  display: flex;
  flex-flow: row nowrap;
  height: 100%;
  border-top: var(--color-list-header-border-bottom);
}

.toc {
  flex: 0 0 16%;
  overflow-y: scroll;
}
.searchBox {
  position: sticky;
  z-index: 2;
  top: 0;
  padding: 10px 8px 8px;
  background-color: var(--color-main-background);
}
.searchIcon {
  position: absolute;
  z-index: 1;
  top: 18px;
  left: 16px;
  width: 13px;
  height: 13px;
  color: var(--color-button-font);
  pointer-events: none;
}
.searchInput {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 26px;
}
.clearSearchBtn {
  position: absolute;
  top: 15px;
  right: 13px;
  width: 20px;
  height: 20px;
  padding: 4px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-button-font);
  cursor: pointer;
  transition: background-color var(--duration-fast) var(--ease-standard);

  &:hover {
    background-color: var(--color-button-background-hover);
  }
  &:focus-visible {
    box-shadow: var(--focus-ring);
    outline: none;
  }
  svg {
    width: 100%;
    height: 100%;
  }
}
.searchEmpty {
  padding: 18px 10px;
  color: var(--color-font-label);
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}
.contentEmpty {
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  color: var(--color-font-label);
  font-size: 13px;
  text-align: center;
  transform: translateY(-50%);
}
.tocH2 {
  line-height: 1.5;
  .mixin-ellipsis-1();
  font-size: 13px;
  color: var(--color-font);
  padding: 8px 10px;
  transition: @transition-fast;
  transition-property: background-color, color;

  &:not(.active) {
    cursor: pointer;
    &:hover {
      background-color: var(--color-button-background-hover);
    }
  }
  &.active {
    color: var(--color-primary);
  }
}
.activeIcon {
  height: .9em;
  width: .9em;
  margin-left: -0.45em;
  vertical-align: -0.05em;
}
// .tocH3 {
//   font-size: 13px;
//   opacity: .8;
// }

// .tocList {
//   .tocList {
//     // padding-left: 15px;
//   }
// }
// .tocSubListItem {
//   padding-top: 10px;
// }

.setting {
  padding: 0 15px 15px;
  font-size: 14px;
  box-sizing: border-box;
  overflow-y: auto;
  height: 100%;
  position: relative;
  width: 100%;

  :global {
    dt {
      border-left: 5px solid var(--color-primary-alpha-700);
      padding: 3px 7px;
      margin: 15px 0;

      + dd h3 {
        margin-top: 0;
      }
    }

    dd {
      // margin-left: 15px;
      // font-size: 13px;
      > div {
        padding: 0 15px;
      }

    }
    h3 {
      font-size: 12px;
      margin: 25px 0 15px;
    }
    .p {
      padding: 3px 0;
      line-height: 1.3;
      .btn {
        + .btn {
          margin-left: 10px;
        }
      }
    }

    .help-btn {
      padding: 0;
      margin: 0 0.4em;
      border: none;
      background: none;
      color: var(--color-button-font);
      cursor: pointer;
      transition: opacity 0.2s ease;
      &:hover {
        opacity: 0.7;
      }
    }
    .help-icon {
      margin: 0 0.4em;
    }
  }
}

.searchFiltering {
  :global {
    dl *:not(.setting-search-visible) {
      display: none !important;
    }
  }
}

// .btn-content {
//   display: inline-block;
//   transition: @transition-theme;
//   transition-property: opacity, transform;
//   opacity: 1;
//   transform: scale(1);

//   &.hide {
//     opacity: 0;
//     transform: scale(0);
//   }
// }


// :global(dt):target, :global(h3):target {
//   animation: highlight 1s ease;
// }

// @keyframes highlight {
//   from { background: yellow; }
//   to { background: transparent; }
// }

</style>

