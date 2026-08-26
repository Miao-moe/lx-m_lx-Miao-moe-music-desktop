import { reactive } from '@common/utils/vueTools'
import type { EntityType } from '@renderer/store/search/entity'
import type { ListDetailInfo } from '@renderer/store/songList/state'

export interface EntitySummary {
  name: string
  author: string
  img: string
  desc: string
  total: number
}

export interface EntityDetailInfo extends ListDetailInfo {
  type: EntityType
  isFallback: boolean
}

export const entityDetailInfo = reactive<EntityDetailInfo>({
  list: [],
  id: '',
  desc: null,
  total: 0,
  page: 1,
  limit: 100,
  key: null,
  source: 'kw',
  type: 'singer',
  isFallback: false,
  info: {},
  noItemLabel: '',
})
