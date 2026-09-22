import { inflate } from 'node:zlib'
import { KEY_1, KEY_2, KEY_3 } from './constants'
import { desCrypt, keySchedule, Mode } from './custom_des'

// DES primitives from qrc-decoder 1.0.2 (MIT); see LICENSE in this directory.
// Keep decompression here so even highly compressed input has a hard output limit.
const keys = [keySchedule(KEY_3, Mode.Decrypt), keySchedule(KEY_2, Mode.Encrypt), keySchedule(KEY_1, Mode.Decrypt)]
export const decodeQrc = async(hex: string): Promise<string> => {
  if (!hex) return ''
  if (typeof hex !== 'string' || hex.length > 512 * 1024 || !/^(?:[a-f\d]{16})+$/i.test(hex)) throw Object.assign(new Error('QQ 歌词编码无效或超过大小限制'), { code: 'QRC_INPUT_INVALID' })
  const input = Buffer.from(hex, 'hex')
  const output = Buffer.alloc(input.length)
  const a = new Uint8Array(8)
  const b = new Uint8Array(8)
  for (let i = 0; i < input.length; i += 8) {
    desCrypt(input.subarray(i, i + 8), a, keys[0])
    desCrypt(a, b, keys[1])
    desCrypt(b, output.subarray(i, i + 8), keys[2])
    // Yield between batches instead of monopolizing the main process.
    if (i && i % 8192 === 0) await new Promise<void>(resolve => setImmediate(resolve))
  }
  return new Promise((resolve, reject) => {
    inflate(output, { maxOutputLength: 8 * 1024 * 1024 }, (error, data) => {
      if (error) reject(Object.assign(error, { code: 'QRC_DECOMPRESS_FAILED' }))
      else resolve(data.toString('utf8').replace(/^\uFEFF/, ''))
    })
  })
}
