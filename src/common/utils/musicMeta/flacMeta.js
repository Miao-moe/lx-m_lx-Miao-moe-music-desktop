const fs = require('fs')
const { randomUUID } = require('node:crypto')
const { pipeline } = require('node:stream/promises')
const { imageSize: getImgSize } = require('image-size')
const download = require('./downloader')
const FlacProcessor = require('./flac-metadata/index')

const writeMeta = async(filePath, meta, picPath) => {
  const data = { vorbis: { vendor: 'LX-M Music', comments: Object.keys(meta).map(key => key.toUpperCase() + '=' + (meta[key] || '')) } }
  if (picPath) {
    const pictureData = await fs.promises.readFile(picPath)
    const info = getImgSize(pictureData)
    const mime = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', tiff: 'image/tiff' }[info.type]
    if (!mime) throw Object.assign(new Error('Unsupported artwork format: ' + info.type), { code: 'ERR_ARTWORK_FORMAT' })
    data.picture = { pictureType: 3, mimeType: mime, description: '', width: info.width, height: info.height, bitsPerPixel: info.type === 'png' ? pictureData[24] * ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[pictureData[25]] || 1) : 24, colors: 0, pictureData }
  }
  const tempPath = filePath + '.' + randomUUID() + '.lxmtemp'
  const processor = new FlacProcessor()
  processor.writeMeta(data)
  try {
    await pipeline(fs.createReadStream(filePath), processor, fs.createWriteStream(tempPath, { flags: 'wx' }))
    if (processor.tasks) throw Object.assign(new Error('Invalid or incomplete FLAC metadata'), { code: 'ERR_FLAC_METADATA' })
    // Replace directly on the same filesystem. Never unlink the original first.
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.unlink(tempPath).catch(error => { if (error.code !== 'ENOENT') console.error(error) })
  }
}
module.exports = async(filePath, metadata, proxy) => {
  const { APIC, ...meta } = metadata
  if (!APIC) return writeMeta(filePath, meta)
  const picturePath = filePath + '.' + randomUUID() + '.artwork'
  try {
    await download(APIC, picturePath, proxy)
    await writeMeta(filePath, meta, picturePath)
  } finally {
    await fs.promises.unlink(picturePath).catch(error => { if (error.code !== 'ENOENT') console.error(error) })
  }
}
