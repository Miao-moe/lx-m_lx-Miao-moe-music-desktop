import { LIST_IDS } from '@common/constants'
import { playList, refreshPlayQueueFromList } from '@renderer/core/player/action'
import { dialog } from '@renderer/plugins/Dialog'
import { createUserList, overwriteListMusics, setTempList } from '@renderer/store/list/action'
import { tempListMeta, userLists } from '@renderer/store/list/state'
import { getEntityDetail, getEntityDetailAll } from '@renderer/store/entityDetail/action'
import type { EntitySummary } from '@renderer/store/entityDetail/state'
import type { EntityType } from '@renderer/store/search/entity'
import { toMD5 } from '@renderer/utils'

const getRawListId = (type: EntityType, id: string, source: LX.OnlineSource) => `entity__${type}__${source}__${id}`
const getUserListId = (type: EntityType, id: string, source: LX.OnlineSource) => `entity_${toMD5(getRawListId(type, id, source))}`

export const addEntityDetail = async(type: EntityType, id: string, source: LX.OnlineSource, summary: EntitySummary, list: LX.Music.MusicInfoOnline[]) => {
  const listId = getUserListId(type, id, source)
  const targetList = userLists.find(listInfo => listInfo.id == listId)
  if (targetList) {
    const confirm = await dialog.confirm({
      message: window.i18n.t('duplicate_list_tip', { name: targetList.name }),
      cancelButtonText: window.i18n.t('lists__import_part_button_cancel'),
      confirmButtonText: window.i18n.t('confirm_button_text'),
    })
    if (!confirm) return
  }

  let fullList = list
  try {
    fullList = await getEntityDetailAll(type, id, source, summary)
  } catch (error) {
    console.log(error)
  }
  if (!fullList.length) return
  if (targetList) {
    await overwriteListMusics({ listId, musicInfos: fullList })
  } else {
    await createUserList({ id: listId, name: summary.name, list: fullList })
  }
}

export const playEntityDetail = async(type: EntityType, id: string, source: LX.OnlineSource, summary: EntitySummary, list: LX.Music.MusicInfoOnline[], index = 0) => {
  const listId = getRawListId(type, id, source)
  if (!list.length) list = (await getEntityDetail(type, id, source, 1, summary)).list
  if (!list.length) return

  await setTempList(listId, [...list])
  playList(LIST_IDS.TEMP, index)

  let fullList: LX.Music.MusicInfoOnline[]
  try {
    fullList = await getEntityDetailAll(type, id, source, summary)
  } catch (error) {
    console.log(error)
    return
  }
  if (!fullList.length || tempListMeta.id != listId) return
  await setTempList(listId, [...fullList])
  refreshPlayQueueFromList(LIST_IDS.TEMP)
}
