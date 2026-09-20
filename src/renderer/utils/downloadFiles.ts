import { getDownloadList } from '@renderer/store/download/action'
import { buildSavePath } from '@renderer/store/download/utils'
import { appSetting } from '@renderer/store/setting'
import { getFileStats, joinPath } from '@common/utils/nodejs'

// Read live task state, including downloads resumed since a plugin panel was opened.
export const getDownloads = async() => getDownloadList()
export const getDownloadSavePaths = (task: LX.Download.ListItem) => [buildSavePath(task), appSetting['download.savePath']]

export const findDownloadFile = async(task: LX.Download.ListItem) => {
  const paths = new Set([task.metadata.filePath, ...getDownloadSavePaths(task).map(directory => joinPath(directory, task.metadata.fileName))])
  for (const path of paths) {
    if (path && (await getFileStats(path))?.isFile()) return path
  }
  return ''
}
