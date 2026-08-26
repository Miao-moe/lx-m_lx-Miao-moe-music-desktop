import { useRoute, useRouter } from '@common/utils/vueRouter'
import { sources as entitySources } from '@renderer/store/search/entity'
import type { EntityType } from '@renderer/store/search/entity'

export default () => {
  const route = useRoute()
  const router = useRouter()

  const canOpenEntity = (item: LX.Music.MusicInfo) => item.source != 'local' && entitySources.includes(item.source)
  const getSingerNames = (item: LX.Music.MusicInfo) => (item.singer || '').split(/、|;|；|\||\s\/\s/).map(name => name.trim()).filter(Boolean)
  const getEntityId = (item: LX.Music.MusicInfo, type: EntityType, name: string) => {
    if (type == 'singer') return `search__singer__${name}`
    if (item.source == 'local') return `search__album__${name}`
    const albumId = item.source == 'tx' ? item.meta.albumMid ?? item.meta.albumId : item.meta.albumId
    return albumId == null || albumId === '' ? `search__album__${name}` : String(albumId)
  }
  const openEntityDetail = (item: LX.Music.MusicInfo, type: EntityType, name: string) => {
    if (!name || !canOpenEntity(item) || item.source == 'local') return
    void router.push({
      path: '/search/entity/detail',
      query: {
        source: item.source,
        type,
        id: getEntityId(item, type, name),
        name,
        author: type == 'album' ? item.singer : undefined,
        picUrl: item.meta.picUrl ?? undefined,
        page: 1,
        from: route.fullPath,
      },
    })
  }

  return {
    canOpenEntity,
    getSingerNames,
    openEntityDetail,
  }
}
