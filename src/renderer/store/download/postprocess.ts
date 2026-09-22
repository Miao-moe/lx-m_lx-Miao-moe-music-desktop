export const finishDownloadFiles = async(info: LX.Download.ListItem, settings: LX.AppSetting, services: {
  lyric: () => Promise<LX.Music.LyricInfo>
  picture: () => Promise<string>
  writeMeta: (meta: any, lyric: LX.Music.LyricInfo) => Promise<unknown>
  saveLrc: (lyric: LX.Music.LyricInfo, options: any) => Promise<unknown>
  cancelled: () => boolean
}) => {
  const canTag = ['mp3', 'flac'].includes(info.metadata.ext)
  const needsLyric = settings['download.isDownloadLrc'] || (canTag && settings['download.isEmbedLyric'])
  const needsPicture = canTag && settings['download.isEmbedPic']
  const results = await Promise.allSettled([
    needsLyric ? services.lyric() : Promise.resolve({ lyric: '' }),
    needsPicture ? services.picture() : Promise.resolve(''),
  ] as const)
  if (services.cancelled()) return
  const errors: string[] = []
  const [lyrics, picture] = results
  if (lyrics.status === 'rejected') errors.push('Lyrics: ' + String(lyrics.reason?.message ?? lyrics.reason))
  if (picture.status === 'rejected') errors.push('Artwork: ' + String(picture.reason?.message ?? picture.reason))
  const lyric = lyrics.status === 'fulfilled' ? lyrics.value : { lyric: '' }
  const jobs: Array<Promise<unknown>> = []
  if (canTag) {
    jobs.push(services.writeMeta({
      filePath: info.metadata.filePath,
      isEmbedLyricLx: settings['download.isEmbedLyricLx'],
      isEmbedLyricT: settings['download.isEmbedLyricT'],
      isEmbedLyricR: settings['download.isEmbedLyricR'],
      title: info.metadata.musicInfo.name,
      artist: info.metadata.musicInfo.singer?.replaceAll('、', ';') ?? '',
      album: info.metadata.musicInfo.meta.albumName ?? '',
      APIC: picture.status === 'fulfilled' ? picture.value || null : null,
    }, settings['download.isEmbedLyric'] ? lyric : { lyric: '' }))
  }
  if (settings['download.isDownloadLrc'] && lyric.lyric) {
    jobs.push(services.saveLrc({ ...lyric, lyric: lyric.lyric.replace(/(?:\[00:(\d\d:\d\d.\d+\]))/gm, '[$1') }, {
      filePath: info.metadata.filePath.replace(/\.[^.]+$/, '.lrc'),
      format: settings['download.lrcFormat'],
      downloadLxlrc: settings['download.isDownloadLxLrc'],
      downloadTlrc: settings['download.isDownloadTLrc'],
      downloadRlrc: settings['download.isDownloadRLrc'],
    }))
  }
  // Every writer must settle before releasing the file's task/lease, even if
  // another post-processing step fails or the user pauses the task meanwhile.
  for (const result of await Promise.allSettled(jobs)) {
    if (result.status === 'rejected') errors.push(String(result.reason?.message ?? result.reason))
  }
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'ERR_DOWNLOAD_POSTPROCESS' })
}
