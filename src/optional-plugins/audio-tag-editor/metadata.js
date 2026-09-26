const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const NodeID3 = require('node-id3')
const { imageSize } = require('image-size')

const MAX_METADATA = 64 * 1024 * 1024
const MAX_COVER = 8 * 1024 * 1024
const MAX_LYRICS = 256 * 1024
const fields = {
  title: ['TIT2', 'TITLE'],
  subtitle: ['TIT3', 'SUBTITLE'],
  artist: ['TPE1', 'ARTIST'],
  albumArtist: ['TPE2', 'ALBUMARTIST', 'ALBUM ARTIST'],
  album: ['TALB', 'ALBUM'],
  year: ['TYER', 'DATE', 'YEAR'],
  track: ['TRCK', 'TRACKNUMBER'],
  disc: ['TPOS', 'DISCNUMBER'],
  genre: ['TCON', 'GENRE'],
  composer: ['TCOM', 'COMPOSER'],
  publisher: ['TPUB', 'PUBLISHER', 'ORGANIZATION'],
  encodedBy: ['TENC', 'ENCODED-BY', 'ENCODEDBY'],
  copyright: ['TCOP', 'COPYRIGHT'],
  comment: ['COMM', 'COMMENT', 'DESCRIPTION'],
}
const fail = code => { throw Object.assign(new Error(code), { code }) }
const hash = data => createHash('sha256').update(data).digest('hex')
const blankTags = () => ({ ...Object.fromEntries(Object.keys(fields).map(key => [key, ''])), lyrics: '' })
const supported = filename => typeof filename === 'string' && /\.(mp3|flac)$/i.test(filename)
const revision = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')

function decodeCover(value) {
  if (!value || typeof value !== 'object' || typeof value.data !== 'string' || typeof value.mime !== 'string' ||
    value.data.length > Math.ceil(MAX_COVER / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data) || value.data.length % 4) fail('INVALID_IMAGE')
  const bytes = Buffer.from(value.data, 'base64')
  if (!bytes.length || bytes.length > MAX_COVER || bytes.toString('base64') !== value.data) fail('INVALID_IMAGE')
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : ''
  if (!mime || value.mime !== mime) fail('INVALID_IMAGE')
  let size
  try { size = imageSize(bytes) } catch { fail('INVALID_IMAGE') }
  const { width, height } = size
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 100_000_000) fail('INVALID_IMAGE')
  const depth = png ? bytes[24] * ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[bytes[25]] ?? 0) : 24
  if (!depth) fail('INVALID_IMAGE')
  return { mime, bytes, width, height, depth }
}

async function readCoverFile(filePath) {
  const filename = path.resolve(filePath)
  const stat = await fs.lstat(filename)
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size || stat.size > MAX_COVER) fail('INVALID_IMAGE')
  const bytes = await fs.readFile(filename)
  if (revision(await fs.lstat(filename)) !== revision(stat)) fail('FILE_CHANGED')
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : 'image/jpeg'
  const cover = { mime, data: bytes.toString('base64') }
  decodeCover(cover)
  return { ...cover, size: bytes.length }
}

const previewCover = (mime, bytes) => ({
  mime,
  data: bytes.length <= MAX_COVER && ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) ? bytes.toString('base64') : null,
  size: bytes.length,
})

async function readAt(file, offset, length) {
  if (length < 0 || length > MAX_METADATA) fail('INVALID_FILE')
  const data = Buffer.alloc(length)
  let done = 0
  while (done < length) {
    const { bytesRead } = await file.read(data, done, length - done, offset + done)
    if (!bytesRead) fail('INVALID_FILE')
    done += bytesRead
  }
  return data
}

function syncSize(data, offset = 0) {
  let value = 0
  for (let i = offset; i < offset + 4; i++) {
    if (data[i] === undefined || data[i] & 0x80) fail('INVALID_FILE')
    value = value * 128 + data[i]
  }
  return value
}
function encodeSize(value) {
  const result = Buffer.alloc(4)
  for (let i = 3; i >= 0; i--) { result[i] = value & 0x7f; value = Math.floor(value / 128) }
  if (value) fail('INVALID_FILE')
  return result
}
function id3Tag(frames, version) {
  const body = Buffer.concat(frames)
  return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, version, 0, 0]), encodeSize(body.length), body])
}
function parseFrames(data, version) {
  const frames = []
  let offset = 0
  while (offset < data.length && data[offset]) {
    if (offset + 10 > data.length) fail('INVALID_FILE')
    const id = data.toString('ascii', offset, offset + 4)
    const size = version === 4 ? syncSize(data, offset + 4) : data.readUInt32BE(offset + 4)
    if (!/^[A-Z0-9]{4}$/.test(id) || !size || offset + 10 + size > data.length) fail('INVALID_FILE')
    const raw = data.subarray(offset, offset + 10 + size)
    frames.push({ id, raw })
    offset += 10 + size
  }
  if (data.subarray(offset).some(byte => byte !== 0)) fail('INVALID_FILE')
  return frames
}

function readFrame(frame, version, id) {
  try { return NodeID3.read(id3Tag([frame.raw], version), { onlyRaw: true })[id] } catch { return null }
}

async function readMp3(file, stat) {
  const header = await readAt(file, 0, 10)
  let version = 3
  let audioOffset = 0
  let frames = []
  if (header.toString('ascii', 0, 3) === 'ID3') {
    version = header[3]
    // Do not reinterpret compressed, globally unsynchronised or extended tags.
    // Downloads written by LX use ordinary ID3v2.3. Unknown frames remain byte-for-byte intact.
    if (![3, 4].includes(version) || header[4] !== 0 || header[5] !== 0) fail('UNSUPPORTED_TAG')
    const length = syncSize(header, 6)
    frames = parseFrames(await readAt(file, 10, length), version)
    audioOffset = 10 + length
  }
  const audioHeader = await readAt(file, audioOffset, 4)
  if (audioHeader[0] !== 0xff || (audioHeader[1] & 0xe0) !== 0xe0 ||
    (audioHeader[1] & 0x18) === 0x08 || !(audioHeader[1] & 0x06) ||
    (audioHeader[2] & 0xf0) === 0xf0 || (audioHeader[2] & 0x0c) === 0x0c) fail('INVALID_FILE')

  const tags = blankTags()
  const rawTags = NodeID3.read(id3Tag(frames.map(frame => frame.raw), version), { onlyRaw: true })
  for (const [key, [id]] of Object.entries(fields)) {
    if (key === 'comment') continue
    const value = key === 'year' ? rawTags.TDRC ?? rawTags.TYER : rawTags[id]
    tags[key] = Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : ''
  }
  const comments = frames.filter(frame => frame.id === 'COMM').map(frame => ({
    frame, value: NodeID3.read(id3Tag([frame.raw], version)).comment,
  }))
  const comment = comments.find(item => item.value && !item.value.shortText)
  if (comment) tags.comment = comment.value.text ?? ''

  const lyricsFrames = frames.filter(frame => frame.id === 'USLT').map(frame => ({ frame, value: readFrame(frame, version, 'USLT') }))
  const lyric = lyricsFrames.find(item => item.value && !item.value.shortText) ?? lyricsFrames.find(item => item.value)
  if (lyric) tags.lyrics = lyric.value.text ?? ''
  const pictures = frames.filter(frame => frame.id === 'APIC').map(frame => ({ frame, value: readFrame(frame, version, 'APIC') }))
  const frontPictures = pictures.filter(item => item.value?.type?.id === 3)
  const picture = frontPictures[0] ?? pictures.find(item => item.value?.imageBuffer)
  const cover = picture?.value?.imageBuffer ? previewCover(picture.value.mime, picture.value.imageBuffer) : null
  const coverFrames = frontPictures.length ? frontPictures.map(item => item.frame) : picture ? [picture.frame] : []

  let trailer = stat.size >= 128 ? await readAt(file, stat.size - 128, 128) : null
  if (trailer?.toString('ascii', 0, 3) !== 'TAG') trailer = null
  if (trailer) {
    for (const [key, start, size] of [['title', 3, 30], ['artist', 33, 30], ['album', 63, 30], ['year', 93, 4], ['comment', 97, trailer[125] === 0 ? 28 : 30]]) {
      // A present v2 frame, including an empty one, takes precedence over v1.
      if (!frames.some(frame => frame.id === fields[key][0]) && !tags[key]) tags[key] = trailer.toString('latin1', start, start + size).replace(/\0.*$/, '').trim()
    }
    if (!tags.track && trailer[125] === 0 && trailer[126]) tags.track = String(trailer[126])
  }
  return { format: 'MP3', tags, cover, coverFrames, lyricValue: lyric?.value, version, frames, comment, trailer, audioOffset, audioEnd: stat.size - (trailer ? 128 : 0) }
}

function parseComments(data) {
  let offset = 0
  const number = () => {
    if (offset + 4 > data.length) fail('INVALID_FILE')
    const result = data.readUInt32LE(offset)
    offset += 4
    return result
  }
  const text = () => {
    const size = number()
    if (offset + size > data.length) fail('INVALID_FILE')
    const result = data.subarray(offset, offset + size)
    offset += size
    return result
  }
  const vendor = text()
  const count = number()
  if (count > data.length / 4) fail('INVALID_FILE')
  const comments = Array.from({ length: count }, text)
  if (offset !== data.length) fail('INVALID_FILE')
  return { vendor, comments }
}
const commentKey = comment => comment.toString('utf8').split('=', 1)[0].toUpperCase()
function encodeComments(vendor, comments) {
  const number = value => { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value); return buffer }
  return Buffer.concat([number(vendor.length), vendor, number(comments.length), ...comments.flatMap(value => [number(value.length), value])])
}
function readFlacPicture(data) {
  let offset = 4
  const number = () => {
    if (offset + 4 > data.length) return null
    const value = data.readUInt32BE(offset)
    offset += 4
    return value
  }
  const bytes = () => {
    const length = number()
    if (length == null || offset + length > data.length) return null
    const value = data.subarray(offset, offset + length)
    offset += length
    return value
  }
  const mime = bytes()
  const description = bytes()
  if (!mime || !description) return null
  for (let i = 0; i < 4; i++) if (number() == null) return null
  const image = bytes()
  return image ? { mime: mime.toString('ascii'), bytes: image } : null
}
function encodeFlacPicture(cover) {
  const number = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes }
  const mime = Buffer.from(cover.mime, 'ascii')
  return Buffer.concat([
    number(3), number(mime.length), mime, number(0),
    number(cover.width), number(cover.height), number(cover.depth), number(0),
    number(cover.bytes.length), cover.bytes,
  ])
}
async function readFlac(file, stat) {
  if ((await readAt(file, 0, 4)).toString('ascii') !== 'fLaC') fail('INVALID_FILE')
  const blocks = []
  let offset = 4
  let last = false
  while (!last) {
    const header = await readAt(file, offset, 4)
    const type = header[0] & 0x7f
    const length = header.readUIntBE(1, 3)
    last = !!(header[0] & 0x80)
    if (type === 127 || offset + length > MAX_METADATA || blocks.length > 1024) fail('INVALID_FILE')
    blocks.push({ type, data: await readAt(file, offset + 4, length) })
    offset += 4 + length
  }
  if (blocks[0].type !== 0 || blocks[0].data.length !== 34 || offset >= stat.size || blocks.filter(block => block.type === 4).length > 1) fail('INVALID_FILE')
  const block = blocks.find(block => block.type === 4)
  const { vendor, comments } = block ? parseComments(block.data) : { vendor: Buffer.from('LX-M Music'), comments: [] }
  const tags = blankTags()
  for (const [key, [, ...names]] of Object.entries(fields)) {
    tags[key] = comments.filter(value => names.includes(commentKey(value))).map(value => value.toString('utf8').slice(value.indexOf(0x3d) + 1)).join('; ')
  }
  const lyric = comments.find(value => commentKey(value) === 'LYRICS') ?? comments.find(value => commentKey(value) === 'UNSYNCEDLYRICS')
  if (lyric) tags.lyrics = lyric.toString('utf8').slice(lyric.indexOf(0x3d) + 1)
  const pictures = blocks.filter(block => block.type === 6 && block.data.length >= 4)
  const frontPictures = pictures.filter(block => block.data.readUInt32BE(0) === 3)
  const picture = frontPictures[0] ?? pictures[0]
  const parsed = picture && readFlacPicture(picture.data)
  const cover = picture ? previewCover(parsed?.mime ?? '', parsed?.bytes ?? Buffer.alloc(0)) : null
  const coverBlocks = frontPictures.length ? frontPictures : picture ? [picture] : []
  return { format: 'FLAC', tags, cover, coverBlocks, blocks, vendor, comments, audioOffset: offset, audioEnd: stat.size }
}

async function inspect(filePath, format = path.extname(filePath).slice(1).toUpperCase()) {
  if (!['MP3', 'FLAC'].includes(format)) fail('UNSUPPORTED_FILE')
  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('INVALID_FILE')
  const file = await fs.open(filePath, 'r')
  try {
    const info = format === 'MP3' ? await readMp3(file, stat) : await readFlac(file, stat)
    if (revision(await file.stat()) !== revision(stat)) fail('FILE_CHANGED')
    return { ...info, filePath, stat, revision: revision(stat) + ':' + hash(await readAt(file, 0, info.audioOffset)) }
  } finally { await file.close() }
}

async function readTags(filePath) {
  const info = await inspect(path.resolve(filePath))
  return { filePath: info.filePath, format: info.format, size: info.stat.size, revision: info.revision, tags: info.tags, cover: info.cover }
}

function updateMp3(info, changes) {
  const removed = new Set(Object.keys(changes).filter(key => Object.hasOwn(fields, key) && key !== 'comment').map(key => fields[key][0]))
  if ('year' in changes) { removed.add('TDRC'); removed.add('TYER') }
  const coverFrames = new Set('cover' in changes ? info.coverFrames : [])
  const kept = info.frames.filter(frame => !removed.has(frame.id) && !(frame === info.comment?.frame && 'comment' in changes) &&
    !(frame.id === 'USLT' && 'lyrics' in changes) && !coverFrames.has(frame)).map(frame => frame.raw)
  const values = Object.fromEntries(Object.entries(changes).filter(([key]) => Object.hasOwn(fields, key)).map(([key, value]) => [
    key === 'year' && info.version === 4 ? 'TDRC' : fields[key][0],
    key === 'comment' ? { language: info.comment?.value.language ?? 'eng', text: value } : value,
  ]))
  if (changes.lyrics) values.USLT = { language: info.lyricValue?.language ?? 'eng', shortText: info.lyricValue?.shortText ?? '', text: changes.lyrics }
  if (changes.cover) values.APIC = { mime: changes.cover.mime, type: { id: 3 }, description: 'Cover', imageBuffer: changes.cover.bytes }
  const generated = parseFrames(NodeID3.create(values).subarray(10), 3).map(frame => {
    if (info.version === 4) encodeSize(frame.raw.length - 10).copy(frame.raw, 4)
    return frame.raw
  })
  let trailer = info.trailer ? Buffer.from(info.trailer) : null
  if (trailer) {
    for (const [key, start, size] of [['title', 3, 30], ['artist', 33, 30], ['album', 63, 30], ['year', 93, 4], ['comment', 97, trailer[125] === 0 ? 28 : 30]]) {
      if (!(key in changes)) continue
      trailer.fill(0, start, start + size)
      if (Array.from(changes[key]).every(character => character.charCodeAt(0) <= 255)) trailer.write(changes[key], start, size, 'latin1')
    }
    if ('track' in changes && trailer[125] === 0) trailer[126] = Math.min(255, parseInt(changes.track) || 0)
    if ('genre' in changes) trailer[127] = 255
  }
  return { header: id3Tag([...kept, ...generated], info.version), trailer }
}
function updateFlac(info, changes) {
  const removed = new Set(Object.keys(changes).filter(key => Object.hasOwn(fields, key)).flatMap(key => fields[key].slice(1)))
  if ('lyrics' in changes) { removed.add('LYRICS'); removed.add('UNSYNCEDLYRICS') }
  const comments = info.comments.filter(value => !removed.has(commentKey(value)))
  for (const [key, value] of Object.entries(changes).filter(([key]) => Object.hasOwn(fields, key))) {
    if (value) comments.push(Buffer.from(fields[key][1] + '=' + value, 'utf8'))
  }
  if (changes.lyrics) comments.push(Buffer.from('LYRICS=' + changes.lyrics, 'utf8'))
  const data = encodeComments(info.vendor, comments)
  if (data.length > 0xffffff) fail('INVALID_TAGS')
  let blocks = info.blocks.map(block => block.type === 4 ? { type: 4, data } : block)
  if (!blocks.some(block => block.type === 4)) blocks.push({ type: 4, data })
  if ('cover' in changes) {
    const removedPictures = new Set(info.coverBlocks)
    const picture = changes.cover ? { type: 6, data: encodeFlacPicture(changes.cover) } : null
    if (picture?.data.length > 0xffffff) fail('INVALID_IMAGE')
    let inserted = false
    blocks = blocks.flatMap(block => {
      if (!removedPictures.has(block)) return [block]
      if (!picture || inserted) return []
      inserted = true
      return [picture]
    })
    if (picture && !inserted) {
      const padding = blocks.findIndex(block => block.type === 1)
      blocks.splice(padding < 0 ? blocks.length : padding, 0, picture)
    }
  }
  const encoded = blocks.flatMap((block, index) => {
    const header = Buffer.alloc(4)
    header[0] = block.type | (index === blocks.length - 1 ? 0x80 : 0)
    header.writeUIntBE(block.data.length, 1, 3)
    return [header, block.data]
  })
  return { header: Buffer.concat([Buffer.from('fLaC'), ...encoded]), trailer: null }
}

const saving = new Set()
async function saveTags(snapshot, updates, beforeReplace = async() => {}) {
  const filePath = path.resolve(snapshot.filePath)
  if (saving.has(filePath)) fail('FILE_BUSY')
  saving.add(filePath)
  let temporary
  let temporaryCreated = false
  try {
    const info = await inspect(filePath)
    if (info.revision !== snapshot.revision) fail('FILE_CHANGED')
    const changes = {}
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'cover') {
        if (value !== null && (typeof value !== 'object' || value.data !== info.cover?.data || value.mime !== info.cover?.mime)) changes.cover = decodeCover(value)
        else if (value === null && info.cover) changes.cover = null
        continue
      }
      if ((key !== 'lyrics' && !Object.hasOwn(fields, key)) || typeof value !== 'string' || value.length > (key === 'lyrics' ? MAX_LYRICS : 10000) || value.includes('\0')) fail('INVALID_TAGS')
      if (value !== info.tags[key]) changes[key] = value
    }
    if (!Object.keys(changes).length) return readTags(filePath)
    const next = info.format === 'MP3' ? updateMp3(info, changes) : updateFlac(info, changes)
    temporary = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.lxtags-' + randomUUID())
    const input = await fs.open(filePath, 'r')
    try {
      if (revision(await input.stat()) !== revision(info.stat)) fail('FILE_CHANGED')
      const output = await fs.open(temporary, 'wx', info.stat.mode)
      temporaryCreated = true
      try {
        await output.writeFile(next.header)
        const buffer = Buffer.alloc(1024 * 1024)
        let position = info.audioOffset
        while (position < info.audioEnd) {
          const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, info.audioEnd - position), position)
          if (!bytesRead) fail('FILE_CHANGED')
          await output.writeFile(buffer.subarray(0, bytesRead))
          position += bytesRead
        }
        if (next.trailer) await output.writeFile(next.trailer)
        await output.sync()
      } finally { await output.close() }
    } finally { await input.close() }
    // Validate the completed replacement before touching the original file.
    await inspect(temporary, info.format)
    await beforeReplace()
    if (revision(await fs.lstat(filePath)) !== revision(info.stat)) fail('FILE_CHANGED')
    await fs.rename(temporary, filePath)
    temporary = undefined
    return await readTags(filePath)
  } finally {
    if (temporary && temporaryCreated) await fs.unlink(temporary).catch(() => {})
    saving.delete(filePath)
  }
}

module.exports = { readTags, readCoverFile, saveTags, supported }
