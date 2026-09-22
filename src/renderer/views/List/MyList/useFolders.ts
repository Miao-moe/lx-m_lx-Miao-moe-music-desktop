import { computed, reactive, watch, type Ref } from '@common/utils/vueTools'
import { COOKIE_SOURCES, SOURCE_NAME, type CookieSource } from '@renderer/utils/cookieManager'
import { userLists } from '@renderer/store/list/state'
import { libraryPreferences } from '@renderer/utils/library'

const STORAGE_KEY = 'my-list-platform-folders'

export const getListFolder = (list?: LX.List.UserListInfo): CookieSource | undefined => {
  return list && COOKIE_SOURCES.find(source => list.id.startsWith(`userlist_${source}_sync_`))
}

export default ({ listId }: { listId: Ref<string> }) => {
  const expandedFolders = reactive<Record<string, boolean>>({})
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const [key, value] of Object.entries(saved)) expandedFolders[key] = value === true
  } catch {}

  const listGroups = computed(() => {
    const groups: Array<{
      id: string
      source?: CookieSource
      name?: string
      lists: Array<{ item: LX.List.UserListInfo, index: number, name: string }>
    }> = [
      { id: 'local', lists: [] },
      { id: 'pinned', name: '置顶', lists: [] },
      ...COOKIE_SOURCES.map(source => ({ id: source, source, name: SOURCE_NAME[source], lists: [] })),
    ]
    userLists.forEach((item, index) => {
      const source = getListFolder(item)
      const organization = libraryPreferences.value.lists[item.id]
      const folder = organization?.pinned ? 'pinned' : organization?.folder ? `folder:${organization.folder}` : source ?? 'local'
      let group = groups.find(group => group.id === folder)
      if (!group) { group = { id: folder, name: organization.folder, lists: [] }; groups.push(group) }
      const prefix = source ? `${SOURCE_NAME[source]} - ` : ''
      const title = prefix && item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name
      const name = title + (organization?.tags.length ? ` · ${organization.tags.join(' / ')}` : '')
      group.lists.push({ item, index, name })
    })
    return groups.filter(group => group.id !== 'pinned' || group.lists.length).sort((a, b) => a.id === 'pinned' ? -1 : b.id === 'pinned' ? 1 : 0)
  })

  watch(() => listGroups.value.find(group => group.lists.some(list => list.item.id === listId.value))?.id, source => {
    if (source) expandedFolders[source] = true
  }, { immediate: true })

  watch(expandedFolders, state => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
  })

  const toggleFolder = (source: string) => {
    expandedFolders[source] = !expandedFolders[source]
  }

  return { listGroups, expandedFolders, toggleFolder }
}
