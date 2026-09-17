const { gzipSync, gunzipSync } = require('node:zlib')

const MAX_PACKAGE_BYTES = 20 * 1024 * 1024
const MAX_UNPACKED_BYTES = 40 * 1024 * 1024
// The JSON envelope contains base64 payloads and a bounded manifest.
const MAX_ENVELOPE_BYTES = Math.ceil(MAX_UNPACKED_BYTES * 4 / 3) + 512 * 1024

const unpackPlugin = bytes => {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PACKAGE_BYTES) throw new Error('Plugin package is too large')
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_ENVELOPE_BYTES }).toString('utf8'))
}

const packPlugin = (manifest, files) => {
  const payload = Buffer.from(JSON.stringify({ manifest, files: Object.fromEntries(files.map(file => [file.path, file.data.toString('base64')])) }))
  if (payload.length > MAX_ENVELOPE_BYTES) throw new Error('Plugin package is too large')
  const bytes = gzipSync(payload, { level: 9 })
  if (bytes.length > MAX_PACKAGE_BYTES) throw new Error('Plugin package is too large')
  return bytes
}

module.exports = { MAX_PACKAGE_BYTES, MAX_UNPACKED_BYTES, packPlugin, unpackPlugin }
