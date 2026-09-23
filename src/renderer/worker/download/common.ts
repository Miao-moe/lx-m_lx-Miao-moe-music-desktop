import { setMeta } from '@common/utils/musicMeta'
import { buildLyrics } from './lrcTool'

export const writeMeta = async({ filePath, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR, ...meta }: {
  filePath: string
  isEmbedLyricLx: boolean
  isEmbedLyricT: boolean
  isEmbedLyricR: boolean
  title: string
  artist: string
  album: string
  APIC: string | null
}, lyric: LX.Music.LyricInfo, proxy?: { host: string, port: number }) => {
  return setMeta(filePath, { ...meta, lyrics: buildLyrics(lyric, isEmbedLyricLx, isEmbedLyricT, isEmbedLyricR) }, proxy)
}

export { saveLrc } from './utils'
