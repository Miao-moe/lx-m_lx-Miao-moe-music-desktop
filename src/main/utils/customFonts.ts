import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { CUSTOM_FONT_PREFIX, MAX_FONT_BYTES, fontError, identifyFont, type CustomFont, type FontImport } from '@common/fonts'
import { writeFileAtomic } from '@common/utils/atomicFile'

export class FontLibrary {
  constructor(private readonly directory: string) {}

  private file(id: string) {
    if (!new RegExp(`^${CUSTOM_FONT_PREFIX}[a-f0-9]{64}$`).test(id)) throw fontError('FONT_ID_INVALID', '字体标识无效，请重新导入。')
    return path.join(this.directory, id)
  }

  async list(): Promise<CustomFont[]> {
    const files = await fs.readdir(this.directory).catch(error => {
      if (error.code === 'ENOENT') return [] as string[]
      throw error
    })
    const fonts: CustomFont[] = []
    for (const file of files.filter(name => name.endsWith('.json'))) {
      const id = file.slice(0, -5)
      const info: CustomFont = JSON.parse(await fs.readFile(`${this.file(id)}.json`, 'utf8'))
      if (info.id !== id || typeof info.name !== 'string' || !['ttf', 'otf', 'woff', 'woff2'].includes(info.format)) {
        throw fontError('FONT_METADATA_INVALID', '已导入字体的信息损坏，请重新导入字体。')
      }
      fonts.push(info)
    }
    return fonts.sort((a, b) => a.name.localeCompare(b.name))
  }

  async import({ name, data }: FontImport): Promise<CustomFont> {
    const bytes = Buffer.from(data)
    const format = identifyFont(bytes)
    const id = CUSTOM_FONT_PREFIX + createHash('sha256').update(bytes).digest('hex')
    const info: CustomFont = { id, name: path.basename(name).replace(/\.[^.]+$/, '').slice(0, 160) || 'Custom font', format }
    // Content-addressed files make repeated imports and concurrent reads safe.
    await writeFileAtomic(this.file(id), bytes)
    await writeFileAtomic(`${this.file(id)}.json`, JSON.stringify(info))
    return info
  }

  async read(id: string) {
    const filename = this.file(id)
    const handle = await fs.open(filename, 'r').catch(error => {
      if (error.code === 'ENOENT') throw fontError('FONT_FILE_MISSING', '找不到已导入的字体文件，请在字体设置中重新导入或选择其他字体。')
      throw error
    })
    try {
      const size = (await handle.stat()).size
      if (!size || size > MAX_FONT_BYTES) throw fontError('FONT_SIZE_LIMIT', '字体文件为空或超过 32 MB。')
      const data = await handle.readFile()
      const format = identifyFont(data)
      if (CUSTOM_FONT_PREFIX + createHash('sha256').update(data).digest('hex') !== id) throw fontError('FONT_FILE_CHANGED', '字体文件已损坏，请重新导入。')
      return { format, data }
    } finally { await handle.close() }
  }
}
