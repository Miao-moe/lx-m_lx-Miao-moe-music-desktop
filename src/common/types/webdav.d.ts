declare namespace LX {
  namespace WebDAV {
    type Section = 'playlists' | 'downloadHistory' | 'downloadTasks' | 'settings' | 'dislike'
    type Operation = 'test' | 'sync' | 'upload' | 'download'

    interface Config {
      url: string
      username: string
      password: string
      directory: string
    }

    interface Data {
      playlists?: LX.Sync.List.ListData
      downloadHistory?: LX.Download.ListItem[]
      downloadTasks?: LX.Download.ListItem[]
      settings?: Partial<LX.AppSetting>
      dislike?: LX.Dislike.DislikeRules
    }

    interface Snapshot {
      type: 'lx-music-webdav'
      version: 1
      updatedAt: number
      data: Data
    }

    type ErrorCode = 'invalid_config' | 'disabled' | 'empty_selection' | 'busy' | 'network' | 'timeout'
    | 'auth' | 'http' | 'invalid_data' | 'too_large' | 'redirect' | 'conflict' | 'remote_changed'
    | 'local_changed' | 'missing_remote' | 'missing_sections' | 'missing_validator' | 'downloads_running' | 'local_error'

    interface Result {
      success: boolean
      operation: Operation
      time: number
      uploaded: Section[]
      downloaded: Section[]
      error?: ErrorCode
      statusCode?: number
      diagnostic?: string
      sections?: Section[]
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Keep this file an ambient namespace declaration.
      diff?: import('../syncDiff').SyncDiff
      lastSuccess?: number
    }
  }
}
