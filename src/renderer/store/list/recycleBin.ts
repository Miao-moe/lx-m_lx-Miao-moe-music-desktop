import { PLAYER_EVENT_NAME } from '@common/ipcNames'
import { rendererInvoke } from '@common/rendererIpc'
import { LIST_TRASH_RETENTION_DAYS } from '@common/listTrash'
import { useI18n } from '@renderer/plugins/i18n'
import toast from '@renderer/plugins/Toast'
import { withLocalListLocks } from './localMutationLock'

export const getListTrash = async() => rendererInvoke<LX.List.TrashEntry[]>(PLAYER_EVENT_NAME.list_trash_get)

export const restoreListTrash = async(entries: LX.List.TrashEntry[]) => {
  const restored = await withLocalListLocks(entries.map(entry => entry.listId), async() => rendererInvoke<string[], string[]>(PLAYER_EVENT_NAME.list_trash_restore, entries.map(entry => entry.id)))
  toast(useI18n()(restored.length ? 'list_trash__restored' : 'list_trash__unavailable'))
}

export const deleteListTrash = async(entries: LX.List.TrashEntry[]) => rendererInvoke<string[]>(PLAYER_EVENT_NAME.list_trash_delete, entries.map(entry => entry.id))

export const deleteWithUndo = async(remove: () => Promise<LX.List.TrashEntry[]>) => {
  const t = useI18n()
  try {
    const entries = await remove()
    if (entries.length) {
      toast(t('list_trash__moved', { days: LIST_TRASH_RETENTION_DAYS }), {
        autoCloseTime: 10000,
        actionText: t('list_trash__undo'),
        onAction: async() => {
          try { await restoreListTrash(entries) } catch { toast(t('list_trash__restore_error')) }
        },
      })
    }
    return true
  } catch {
    toast(t('list_trash__delete_error'))
    return false
  }
}
