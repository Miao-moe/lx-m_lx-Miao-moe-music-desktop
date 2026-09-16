import { getDownloadList } from '@renderer/store/download/action'
import { buildSavePath } from '@renderer/store/download/utils'
import { appSetting } from '@renderer/store/setting'

// Read live task state, including downloads resumed since a plugin panel was opened.
export const getDownloads = async() => getDownloadList()
export const getDownloadSavePaths = (task: LX.Download.ListItem) => [buildSavePath(task), appSetting['download.savePath']]
