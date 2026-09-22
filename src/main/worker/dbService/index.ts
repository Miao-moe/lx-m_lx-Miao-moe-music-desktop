import { init } from './db'
import { exposeWorker } from '../utils/worker'
import { list, lyric, music_url, music_other_source, download, dislike_list } from './modules/index'
import * as backup from './backup'
import * as library from './library'
import { bumpSyncRevision } from './syncRevision'


const common = {
  init: async(root: string) => {
    const result = init(root)
    if (result !== null) await backup.recoverBackup(root)
    return result
  },
}

const methods = Object.assign(common, list, lyric, music_url, music_other_source, download, dislike_list, backup, library)
let pending: Promise<unknown> = Promise.resolve()
exposeWorker(Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, async(...args: any[]) => {
  const task = pending.then(async() => {
    try { return await (method as (...args: any[]) => unknown)(...args) } finally {
      if (['backupRestore', 'webdavRestore'].includes(name)) bumpSyncRevision(['playlists', 'downloads', 'dislike'])
      else if (Object.hasOwn(list, name) && !/^(get|check|reset)/.test(name)) bumpSyncRevision(['playlists'])
      else if (Object.hasOwn(download, name) && !/^(get|reset)/.test(name)) bumpSyncRevision(['downloads'])
      else if (name.startsWith('dislikeInfo')) bumpSyncRevision(['dislike'])
    }
  })
  pending = task.catch(() => {})
  return task
}])))

export type workerDBSeriveTypes = typeof common
  & typeof list
  & typeof lyric
  & typeof music_url
  & typeof music_other_source
  & typeof download
  & typeof dislike_list
  & typeof backup
  & typeof library
