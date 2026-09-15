const NodeID3 = require('node-id3')

const frame = (id, bytes) => {
  const header = Buffer.alloc(10)
  header.write(id)
  header.writeUInt32BE(bytes.length, 4)
  return Buffer.concat([header, bytes])
}
const mp3 = (tags = {}, version = 3) => {
  const tag = NodeID3.create(tags)
  const extra = frame('ZZZZ', Buffer.from('unknown frame to preserve'))
  let length = tag.length - 10 + extra.length
  for (let i = 9; i >= 6; i--) { tag[i] = length & 127; length >>>= 7 }
  const header = Buffer.concat([tag, extra, Buffer.alloc(32)])
  length = header.length - 10
  for (let i = 9; i >= 6; i--) { header[i] = length & 127; length >>>= 7 }
  if (version === 4) {
    header[3] = 4
    let position = 10
    while (header[position]) {
      const size = header.readUInt32BE(position + 4)
      let encoded = size
      for (let i = position + 7; i >= position + 4; i--) { header[i] = encoded & 127; encoded >>>= 7 }
      position += 10 + size
    }
  }
  // MPEG-1 layer III frames, 128 kbps, 44.1 kHz. No copyrighted recording is used.
  const audio = Buffer.alloc(417 * 12)
  for (let i = 0; i < audio.length; i += 417) audio.set([0xff, 0xfb, 0x90, 0x00], i)
  return { bytes: Buffer.concat([header, audio]), audio, extra }
}
const flac = (comments = []) => {
  const block = (type, data) => {
    const header = Buffer.alloc(4)
    header[0] = type
    header.writeUIntBE(data.length, 1, 3)
    return Buffer.concat([header, data])
  }
  const number = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes }
  const string = value => { const bytes = Buffer.from(value); return Buffer.concat([number(bytes.length), bytes]) }
  const streamInfo = Buffer.alloc(34)
  streamInfo.writeUInt16BE(4096, 0)
  streamInfo.writeUInt16BE(4096, 2)
  streamInfo.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | 44100n, 10)
  const artwork = Buffer.alloc(34)
  artwork.writeUInt32BE(3, 0)
  const application = block(2, Buffer.from('LX-M opaque application data'))
  const picture = block(6, artwork)
  const audio = Buffer.from([0xff, 0xf8, 0x69, 0x18, 0, 0, 0, 0, 0, 0])
  const vorbis = Buffer.concat([string('Original vendor'), number(comments.length), ...comments.map(string)])
  return {
    bytes: Buffer.concat([Buffer.from('fLaC'), block(0, streamInfo), application, picture, block(4, vorbis), block(0x81, Buffer.alloc(64)), audio]),
    audio, application, picture,
  }
}
module.exports = { mp3, flac }
