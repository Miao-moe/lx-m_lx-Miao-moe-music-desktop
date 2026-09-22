import { LIST_IDS } from '@common/constants'
import { markRaw, reactive } from '@common/utils/vueTools'
import { BoundedMap } from '@common/utils/boundedMap'

const visibleLists = new Map<string, number>()
export const allMusicList = markRaw(new BoundedMap<string, LX.Music.MusicInfo[]>(12, 50000, songs => songs.length, id =>
  id === LIST_IDS.TEMP || visibleLists.has(id) || id === window.lxData.playInfo?.playerListId || id === window.lxData.playMusicInfo?.listId))
export const retainMusicList = (id: string) => {
  visibleLists.set(id, (visibleLists.get(id) ?? 0) + 1)
  return () => {
    const count = (visibleLists.get(id) ?? 1) - 1
    if (count) visibleLists.set(id, count)
    else visibleLists.delete(id)
    allMusicList.prune()
  }
}

export const defaultList = markRaw<LX.List.MyDefaultListInfo>({
  id: LIST_IDS.DEFAULT,
  name: 'list__name_default',
  // name: '试听列表',
})

export const loveList = markRaw<LX.List.MyLoveListInfo>({
  id: LIST_IDS.LOVE,
  name: 'list__name_love',
  // name: '我的收藏',
})
export const tempList = markRaw<LX.List.MyTempListInfo>({
  id: LIST_IDS.TEMP,
  name: '临时列表',
  meta: {},
})

export const userLists: LX.List.UserListInfo[] = reactive([])
