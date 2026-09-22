import { imageSize } from 'image-size'

export const MAX_ARTWORK_BYTES = 10 * 1024 * 1024
export const MAX_ARTWORK_PIXELS = 16_000_000
export const validateArtwork = (data: Uint8Array) => {
  if (!data.byteLength || data.byteLength > MAX_ARTWORK_BYTES) throw Object.assign(new Error('封面文件为空或超过 10 MB'), { code: 'COVER_SIZE_LIMIT' })
  let dimensions: { width?: number, height?: number }
  try { dimensions = imageSize(Buffer.from(data.buffer, data.byteOffset, data.byteLength)) } catch (cause) {
    throw Object.assign(new Error('封面不是可识别的图片格式', { cause }), { code: 'COVER_FORMAT_INVALID' })
  }
  const { width = 0, height = 0 } = dimensions
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_ARTWORK_PIXELS) {
    throw Object.assign(new Error('封面像素尺寸超过限制（单边 8192，最多 1600 万像素）'), { code: 'COVER_PIXEL_LIMIT' })
  }
  return { width, height, decodedBytes: width * height * 4 }
}

export const readArtworkResponse = async(response: Response) => {
  if (Number(response.headers?.get('content-length')) > MAX_ARTWORK_BYTES) {
    await response.body?.cancel()
    throw Object.assign(new Error('封面响应超过 10 MB'), { code: 'COVER_SIZE_LIMIT' })
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const blob = await response.blob()
    if (blob.size > MAX_ARTWORK_BYTES) throw Object.assign(new Error('封面响应超过 10 MB'), { code: 'COVER_SIZE_LIMIT' })
    return blob
  }
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_ARTWORK_BYTES) throw Object.assign(new Error('封面响应超过 10 MB'), { code: 'COVER_SIZE_LIMIT' })
      chunks.push(value)
    }
    return new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') ?? '' })
  } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { reader.releaseLock() }
}
