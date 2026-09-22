const NodeID3 = require('node-id3')
const fs = require('fs')
const { randomUUID } = require('node:crypto')
const download = require('./downloader')

module.exports = async(filePath, metadata, proxy) => {
  const { APIC, lyrics, ...meta } = metadata
  if (lyrics) meta.unsynchronisedLyrics = { language: 'zho', text: lyrics }
  const picturePath = filePath + '.' + randomUUID() + '.artwork'
  const tempPath = filePath + '.' + randomUUID() + '.lxmtemp'
  try {
    if (APIC) {
      await download(APIC, picturePath, proxy)
      meta.APIC = picturePath
    }
    await fs.promises.copyFile(filePath, tempPath, fs.constants.COPYFILE_EXCL)
    await new Promise((resolve, reject) => NodeID3.write(meta, tempPath, error => error ? reject(error) : resolve()))
    await fs.promises.rename(tempPath, filePath)
  } finally {
    await fs.promises.unlink(tempPath).catch(error => { if (error.code !== 'ENOENT') console.error(error) })
    if (APIC) await fs.promises.unlink(picturePath).catch(error => { if (error.code !== 'ENOENT') console.error(error) })
  }
}
