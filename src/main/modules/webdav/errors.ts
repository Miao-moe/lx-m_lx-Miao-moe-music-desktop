export class WebDAVError extends Error {
  constructor(public readonly code: LX.WebDAV.ErrorCode, public readonly sections?: LX.WebDAV.Section[], public readonly statusCode?: number, public readonly cause?: unknown) {
    super(code)
  }
}
