import fs from 'fs'
import path from 'path'
import { EventEmitter } from 'events'
import { performance } from 'perf_hooks'
import { URL } from 'url'
import { finished } from 'node:stream/promises'
import { STATUS } from './util'
import type http from 'http'
import { request, type Options as RequestOptions } from './request'

export interface Options {
  forceResume: boolean
  timeout: number
  rateLimit: number
  requestOptions: RequestOptions
}
const failure = (message: string, code: string) => Object.assign(new Error(message), { code })

class Task extends EventEmitter {
  resumeLastChunk: Buffer | null = null
  downloadUrl: string
  chunkInfo: { path: string, startByte: string, endByte: string }
  status: typeof STATUS[keyof typeof STATUS] = STATUS.idle
  options: Options
  requestOptions: RequestOptions
  ws: fs.WriteStream | null = null
  progress = { total: 0, downloaded: 0, speed: 0, progress: 0 }
  statsEstimate = { time: 0, bytes: 0, prevBytes: 0 }
  requestInstance: http.ClientRequest | null = null
  maxRedirectNum = 10
  private generation = 0
  private response: http.IncomingMessage | null = null
  private closing: Promise<void> = Promise.resolve()
  private initializing: Promise<void> = Promise.resolve()
  private timeout: NodeJS.Timeout | undefined
  private rateTimer: NodeJS.Timeout | undefined
  private releaseRateWait: (() => void) | undefined
  private nextWriteAt = 0
  private dataWriteQueueLength = 0

  constructor(url: string, savePath: string, filename: string, options: Partial<Options> = {}) {
    super()
    this.downloadUrl = url
    this.chunkInfo = { path: path.join(savePath, filename), startByte: '0', endByte: '' }
    this.options = { forceResume: true, timeout: 20000, rateLimit: 0, requestOptions: { method: 'get' }, ...options }
    this.requestOptions = { ...this.options.requestOptions, headers: { ...this.options.requestOptions.headers } }
  }

  private current(generation: number) {
    return this.generation === generation && (this.status === STATUS.init || this.status === STATUS.running)
  }

  async __init(generation = this.generation) {
    this.resumeLastChunk = null
    Object.assign(this.progress, { total: 0, downloaded: 0, speed: 0, progress: 0 })
    this.requestOptions.headers!.range = `bytes=${this.chunkInfo.startByte}-${this.chunkInfo.endByte}`
    let stats
    try { stats = await fs.promises.stat(this.chunkInfo.path) } catch (error: any) {
      if (error.code === 'ENOENT') return
      throw error
    }
    if (!this.current(generation) || stats.size < 10) return
    const handle = await fs.promises.open(this.chunkInfo.path, 'r')
    let tail: Buffer
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(10), 0, 10, stats.size - 10)
      if (bytesRead !== 10) throw failure('Resume failed, incomplete local file read', 'ERR_DOWNLOAD_RESUME')
      tail = buffer
    } finally { await handle.close() }
    if (!this.current(generation)) return
    this.resumeLastChunk = tail
    this.progress.downloaded = stats.size
    this.requestOptions.headers!.range = `bytes=${stats.size - 10}-${this.chunkInfo.endByte}`
  }

  private clearTimers() {
    clearTimeout(this.timeout)
    clearTimeout(this.rateTimer)
    this.releaseRateWait?.()
    this.releaseRateWait = undefined
  }

  private armTimeout(generation: number) {
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => { void this.fail(failure('Download timeout', 'ETIMEDOUT'), generation) }, this.options.timeout)
  }

  private closeTransport() {
    this.response?.destroy()
    this.response = null
    this.requestInstance?.destroy()
    this.requestInstance = null
  }

  private async closeWriter() {
    const writer = this.ws
    this.ws = null
    if (!writer) return this.closing
    this.closing = (async() => {
      const closed = finished(writer)
      writer.end()
      await closed
    })()
    void this.closing.catch(() => {})
    return this.closing
  }

  private async fail(error: Error, generation: number) {
    if (!this.current(generation)) return
    this.status = STATUS.error
    this.clearTimers()
    this.closeTransport()
    try { await this.closeWriter() } catch (writeError: any) { error = writeError }
    if (this.generation === generation && this.status === STATUS.error) this.emit('error', error)
  }

  private fetch(url: string, options: RequestOptions, generation: number, redirects = 0) {
    if (!this.current(generation)) return
    this.armTimeout(generation)
    let redirected = false
    const req = request(url, options)
    this.requestInstance = req
    req.once('error', error => { if (!redirected) void this.fail(error, generation) })
    req.once('response', response => {
      if (!this.current(generation)) { response.destroy(); return }
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location && redirects < this.maxRedirectNum) {
        redirected = true
        response.destroy()
        try {
          const location = new URL(response.headers.location, url)
          const headers = { ...options.headers }
          if (location.origin !== new URL(url).origin) {
            for (const name of Object.keys(headers)) {
              if (['authorization', 'cookie', 'host'].includes(name.toLowerCase())) Reflect.deleteProperty(headers, name)
            }
          }
          this.fetch(location.href, { ...options, headers, method: status === 303 && options.method !== 'head' ? 'get' : options.method }, generation, redirects + 1)
        } catch (error: any) { void this.fail(error, generation) }
        return
      }
      if (status !== 200 && status !== 206) {
        if (status === 416) { void this.fail(failure('Resume failed, HTTP 416', 'ERR_DOWNLOAD_RESUME'), generation); response.destroy(); return }
        this.status = STATUS.failed
        this.clearTimers()
        response.destroy()
        this.closeTransport()
        this.emit('fail', response)
        return
      }
      this.response = response
      this.emit('response', response)
      void this.consume(response, generation).catch(async error => this.fail(error, generation))
    })
    req.end()
  }

  private async consume(response: http.IncomingMessage, generation: number) {
    const length = Number(response.headers['content-length'])
    const contentLength = Number.isSafeInteger(length) && length >= 0 ? length : 0
    if (response.statusCode === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers['content-range'] ?? '')
      const expected = this.resumeLastChunk ? this.progress.downloaded - this.resumeLastChunk.length : Number(this.chunkInfo.startByte)
      if (!range || Number(range[1]) !== expected || Number(range[2]) < expected) throw failure('Resume failed, invalid Content-Range', 'ERR_DOWNLOAD_RESUME')
      this.progress.total = range[3] !== '*' ? Number(range[3]) : contentLength ? contentLength + expected : 0
    } else {
      if (this.chunkInfo.startByte !== '0') throw failure('Resume failed, server ignored Range', 'ERR_DOWNLOAD_RESUME')
      this.resumeLastChunk = null
      this.progress.downloaded = 0
      this.progress.total = contentLength
    }
    this.statsEstimate.prevBytes = this.progress.downloaded
    const writer = fs.createWriteStream(this.chunkInfo.path, { flags: this.resumeLastChunk ? 'a' : 'w', highWaterMark: 64 * 1024 })
    this.ws = writer
    writer.on('error', error => { void this.fail(error, generation) })
    this.nextWriteAt = performance.now()
    // Await disk writes: the response's high-water mark bounds unread data.
    for await (const data of response) {
      if (!this.current(generation)) return
      clearTimeout(this.timeout)
      let chunk: Buffer = data
      if (this.resumeLastChunk) {
        const length = Math.min(chunk.length, this.resumeLastChunk.length)
        if (!chunk.subarray(0, length).equals(this.resumeLastChunk.subarray(0, length))) throw failure('Resume failed, response chunk does not match', 'ERR_DOWNLOAD_RESUME')
        this.resumeLastChunk = this.resumeLastChunk.length === length ? null : this.resumeLastChunk.subarray(length)
        chunk = chunk.subarray(length)
      }
      if (this.options.rateLimit > 0 && chunk.length) {
        this.nextWriteAt = Math.max(this.nextWriteAt, performance.now()) + chunk.length * 1000 / this.options.rateLimit
        await new Promise<void>(resolve => {
          this.releaseRateWait = resolve
          this.rateTimer = setTimeout(resolve, Math.max(0, this.nextWriteAt - performance.now()))
        })
        this.releaseRateWait = undefined
      }
      if (!this.current(generation)) return
      this.dataWriteQueueLength = 1
      await new Promise<void>((resolve, reject) => writer.write(chunk, error => { error ? reject(error) : resolve() }))
      this.dataWriteQueueLength = 0
      if (!this.current(generation)) return
      this.__calculateProgress(chunk.length)
      this.armTimeout(generation)
    }
    clearTimeout(this.timeout)
    if (!this.current(generation)) return
    if (!response.complete || this.progress.downloaded <= 0 || this.resumeLastChunk) throw failure('Empty or incomplete download', 'ERR_DOWNLOAD_INCOMPLETE')
    await this.closeWriter()
    if (!this.current(generation)) return
    if (!this.progress.total) this.progress.total = this.progress.downloaded
    if (this.progress.downloaded !== this.progress.total) throw failure('Incomplete download', 'ERR_DOWNLOAD_INCOMPLETE')
    this.__calculateProgress(0)
    this.status = STATUS.completed
    this.emit('completed')
  }

  __calculateProgress(receivedBytes: number) {
    const time = performance.now()
    this.progress.downloaded += receivedBytes
    this.progress.progress = this.progress.total ? this.progress.downloaded / this.progress.total * 100 : -1
    if (this.progress.downloaded === this.progress.total || time - this.statsEstimate.time > 1000) {
      this.progress.speed = (this.progress.downloaded - this.statsEstimate.prevBytes) * 1000 / Math.max(1, time - this.statsEstimate.time)
      this.statsEstimate.time = time
      this.statsEstimate.prevBytes = this.progress.downloaded
      this.emit('progress', { ...this.progress, writeQueue: this.dataWriteQueueLength })
    }
  }

  async start() {
    const generation = ++this.generation
    this.clearTimers()
    this.closeTransport()
    this.status = STATUS.init
    this.initializing = (async() => {
      try {
        await this.closeWriter()
        if (!this.current(generation)) return
        await this.__init(generation)
        if (!this.current(generation)) return
        this.status = STATUS.running
        this.fetch(this.downloadUrl, this.requestOptions, generation)
        this.emit('start')
      } catch (error: any) { await this.fail(error, generation) }
    })()
    await this.initializing
  }

  async stop() {
    ++this.generation
    const completed = this.status === STATUS.completed
    if (!completed) this.status = STATUS.stopped
    this.clearTimers()
    this.closeTransport()
    try { await this.closeWriter() } finally { await this.initializing }
    if (!completed) this.emit('stop')
  }

  setRateLimit(bytesPerSecond: number) { this.options.rateLimit = Math.max(0, bytesPerSecond || 0); this.nextWriteAt = performance.now(); clearTimeout(this.rateTimer); this.releaseRateWait?.() }
  refreshUrl(url: string) { this.downloadUrl = url }
  updateSaveInfo(filePath: string, fileName: string) { this.chunkInfo.path = path.join(filePath, fileName) }
}
export default Task
