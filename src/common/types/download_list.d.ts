import { type Message } from '@root/lang'

// interface DownloadList {

// }


declare global {
  namespace LX {
    namespace Download {
      type DownloadTaskStatus = 'run'
      | 'waiting'
      | 'pause'
      | 'error'
      | 'completed'

      type FileExt = 'mp3' | 'flac' | 'wav' | 'ape'

      interface ProgressInfo {
        progress: number
        speed: string
        downloaded: number
        total: number
        writeQueue: number
      }

      interface DownloadTaskActionBase <A> {
        action: A
      }
      interface DownloadTaskActionData<A, D> extends DownloadTaskActionBase<A> {
        data: D
      }
      type DownloadTaskAction<A, D = undefined> = D extends undefined ? DownloadTaskActionBase<A> : DownloadTaskActionData<A, D>

      type DownloadTaskActions = DownloadTaskAction<'start'>
      | DownloadTaskAction<'complete'>
      | DownloadTaskAction<'refreshUrl'>
      | DownloadTaskAction<'statusText', string>
      | DownloadTaskAction<'progress', ProgressInfo>
      | DownloadTaskAction<'filePath', { filePath: string, fileName: string }>
      | DownloadTaskAction<'error', {
        error?: keyof Message
        message?: string
        code?: string
        kind?: import('../utils/download/errors').DownloadFailureKind
      }>

      interface ListItem {
        id: string
        isComplate: boolean
        status: DownloadTaskStatus
        statusText: string
        downloaded: number
        total: number
        progress: number
        speed: string
        writeQueue: number
        priority?: number
        audioDownloaded?: boolean
        failure?: { kind: import('../utils/download/errors').DownloadFailureKind, code?: string, message?: string }
        metadata: {
          musicInfo: LX.Music.MusicInfoOnline
          url: string | null
          quality: LX.Quality
          ext: FileExt
          fileName: string
          filePath: string
          fileAllocated?: boolean
          listId?: string
        }
      }

      interface saveDownloadMusicInfo {
        list: ListItem[]
        addMusicLocationType: LX.AddMusicLocationType
      }
    }
  }
}
