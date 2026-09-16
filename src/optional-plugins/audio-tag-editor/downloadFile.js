const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')
const { supported } = require('./metadata')

const fail = code => { throw Object.assign(new Error(code), { code }) }
const isComplete = task => task?.isComplate === true && task.status === 'completed'
const canEditDownload = task => isComplete(task) && supported(task.metadata?.fileName || task.metadata?.filePath)
const absolutePath = value => typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value) ? path.normalize(value) : ''
const pathKey = value => process.platform === 'win32' ? value.toLowerCase() : value
const sameFilePath = (left, right) => pathKey(path.resolve(left)) === pathKey(path.resolve(right))
const isMissing = error => error.code === 'ENOENT' || error.code === 'ENOTDIR'

async function checkFile(filePath) {
  if (!supported(filePath)) fail('UNSUPPORTED_FILE')
  const stat = await fs.lstat(filePath)
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) fail('INVALID_FILE')
  await fs.access(filePath, constants.R_OK)
  return filePath
}

async function resolveDownloadFile(task, savePaths = []) {
  if (!task) fail('TASK_MISSING')
  // isComplate remains true when a completed task is restarted. Check both fields.
  if (!isComplete(task)) fail('DOWNLOAD_INCOMPLETE')
  const storedPath = absolutePath(task.metadata?.filePath)
  if (storedPath) {
    try { return await checkFile(storedPath) } catch (error) { if (!isMissing(error)) throw error }
  }

  const filename = task.metadata?.fileName || (storedPath && path.basename(storedPath))
  if (typeof filename !== 'string' || !filename || filename.includes('\0') ||
    path.win32.basename(filename) !== filename || path.posix.basename(filename) !== filename) fail('INVALID_PATH')
  if (!supported(filename)) fail('UNSUPPORTED_FILE')
  const visited = new Set(storedPath ? [pathKey(storedPath)] : [])
  const matches = new Map()
  for (const directory of savePaths) {
    const base = absolutePath(directory)
    if (!base) continue
    const candidate = path.join(base, filename)
    const key = pathKey(candidate)
    if (visited.has(key)) continue
    visited.add(key)
    try {
      await checkFile(candidate)
      matches.set(pathKey(await fs.realpath(candidate)), candidate)
    } catch (error) { if (!isMissing(error)) throw error }
  }
  // Never choose arbitrarily between two different songs with the same filename.
  if (matches.size > 1) fail('AMBIGUOUS_FILE')
  if (!matches.size) fail('ENOENT')
  return matches.values().next().value
}

module.exports = { canEditDownload, resolveDownloadFile, sameFilePath }
