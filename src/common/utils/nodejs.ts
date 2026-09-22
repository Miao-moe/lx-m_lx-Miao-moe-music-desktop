import fs from 'node:fs'
import crypto from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import path from 'node:path'
import { networkInterfaces } from 'node:os'
import { log } from '@common/utils'
import { writeFileAtomic } from './atomicFile'
import { MAX_BACKUP_FILE, MAX_BACKUP_EXPANDED, BackupError, validateJsonTree } from '../backup'

export const joinPath = (...paths: string[]): string => path.join(...paths)

export const extname = (p: string): string => path.extname(p)
export const basename = (p: string, ext?: string): string => path.basename(p, ext)
export const dirname = (p: string): string => path.dirname(p)

/**
 * 检查路径是否存在
 * @param {*} path 路径
 */
export const checkPath = async(path: string): Promise<boolean> => {
  return new Promise(resolve => {
    if (!path) {
      resolve(false)
      return
    }
    fs.access(path, fs.constants.F_OK, err => {
      if (err) {
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}

/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
export const checkAndCreateDir = async(path: string) => {
  return fs.promises.access(path, fs.constants.F_OK | fs.constants.W_OK)
    .catch(async(err: NodeJS.ErrnoException) => {
      if (err.code != 'ENOENT') throw err as Error
      return fs.promises.mkdir(path, { recursive: true })
    })
    .then(() => true)
    .catch((err) => {
      console.error(err)
      return false
    })
}


export const getFileStats = async(path: string): Promise<fs.Stats | null> => {
  return new Promise(resolve => {
    if (!path) {
      resolve(null)
      return
    }
    fs.stat(path, (err, stats) => {
      if (err) {
        resolve(null)
        return
      }
      resolve(stats)
    })
  })
}

/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
export const createDir = async(path: string) => new Promise<void>((resolve, reject) => {
  fs.access(path, fs.constants.F_OK | fs.constants.W_OK, err => {
    if (err) {
      if (err.code === 'ENOENT') {
        fs.mkdir(path, { recursive: true }, err => {
          if (err) {
            reject(err)
            return
          }
          resolve()
        })
        return
      }
      reject(err)
      return
    }
    resolve()
  })
})

export const removeFile = async(path: string) => new Promise<void>((resolve, reject) => {
  fs.access(path, fs.constants.F_OK, err => {
    if (err) {
      err.code == 'ENOENT' ? resolve() : reject(err)
      return
    }
    fs.unlink(path, err => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
})

export const readFile = async(path: string) => fs.promises.readFile(path)


/**
 * 创建 MD5 hash
 * @param {*} str
 */
export const toMD5 = (str: string) => crypto.createHash('md5').update(str).digest('hex')

export const gzipData = async(str: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    gzip(str, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      resolve(result)
    })
  })
}

export const gunzipData = async(buf: Buffer): Promise<string> => {
  return new Promise((resolve, reject) => {
    gunzip(buf, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      resolve(result.toString())
    })
  })
}

/**
 * 保存lx配置文件
 * @param path 保存路径
 * @param data 数据
 */
export const saveLxConfigFile = async(path: string, data: any) => {
  if (!path.toLowerCase().endsWith('.lxmc')) path += '.lxmc'
  const json = JSON.stringify(data)
  if (Buffer.byteLength(json) > MAX_BACKUP_EXPANDED) throw new BackupError('expanded_size')
  const bytes = await gzipData(json)
  if (bytes.length > MAX_BACKUP_FILE) throw new BackupError('file_size')
  await writeFileAtomic(path, bytes)
  return path
}

export const readFileLimited = async(filename: string, limit: number) => {
  const file = await fs.promises.open(filename, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > limit) throw new BackupError('file_size')
    const bytes = Buffer.alloc(stat.size + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, length)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    if (length !== stat.size) throw new BackupError('file_changed')
    return bytes.subarray(0, length)
  } finally { await file.close() }
}

/**
 * 读取lx配置文件
 * @param path 文件路径
 * @returns 数据
 */
export const readLxConfigFile = async(path: string): Promise<any> => {
  const bytes = await readFileLimited(path, MAX_BACKUP_FILE)
  let json: string
  if (path.toLowerCase().endsWith('.json')) json = bytes.toString('utf8')
  else {
    try {
      json = await new Promise<string>((resolve, reject) => {
        gunzip(bytes, { maxOutputLength: MAX_BACKUP_EXPANDED }, (error, result) => {
          if (error) reject(error)
          else resolve(result.toString('utf8'))
        })
      })
    } catch (error: any) { throw new BackupError(error.code === 'ERR_BUFFER_TOO_LARGE' ? 'expanded_size' : 'compression') }
  }
  let data: any
  try {
    data = JSON.parse(json.replace(/^\uFEFF/, ''))
    // v1.14.0 exported JSON twice. Only accept the historical extra string layer.
    if (typeof data === 'string') data = JSON.parse(data)
  } catch { throw new BackupError('json') }
  validateJsonTree(data)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BackupError('invalid')
  return data
}

export const saveStrToFile = async(path: string, str: string | Buffer): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    fs.writeFile(path, str, err => {
      if (err) {
        log.error(err)
        reject(err)
        return
      }
      resolve()
    })
  })
}

export const b64DecodeUnicode = (str: string): string => {
  // Going backwards: from bytestream, to percent-encoding, to original string.
  // return decodeURIComponent(window.atob(str).split('').map(function(c) {
  //   return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
  // }).join(''))

  return Buffer.from(str, 'base64').toString()
}

export const copyFile = async(sourcePath: string, distPath: string) => {
  return fs.promises.copyFile(sourcePath, distPath)
}

export const moveFile = async(sourcePath: string, distPath: string) => {
  return fs.promises.rename(sourcePath, distPath)
}

export const getAddress = (): string[] => {
  const nets = networkInterfaces()
  const results: string[] = []
  // console.log(nets)

  for (const interfaceInfos of Object.values(nets)) {
    if (!interfaceInfos) continue
    // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
    for (const interfaceInfo of interfaceInfos) {
      if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
        results.push(interfaceInfo.address)
      }
    }
  }
  return results
}
