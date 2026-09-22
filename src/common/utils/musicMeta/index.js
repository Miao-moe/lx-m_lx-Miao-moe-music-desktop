const path = require('path')
const mp3Meta = require('./mp3Meta')
const flacMeta = require('./flacMeta')

exports.setMeta = (filePath, meta, proxy) => {
  switch (path.extname(filePath)) {
    case '.mp3':
      return mp3Meta(filePath, meta, proxy)
    case '.flac':
      return flacMeta(filePath, meta, proxy)
  }
}
