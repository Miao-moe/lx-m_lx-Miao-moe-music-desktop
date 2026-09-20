// Separate disposable artwork from the SQLite database that owns the user's playlists.
const DATABASE = 'lx-artwork-cache'
const MAX_BYTES = 256 * 1024 * 1024
const MAX_ENTRIES = 10000
const MAX_ENTRY_BYTES = 2 * 1024 * 1024

interface CacheMeta { key: string, bytes: number, time: number }
let database: Promise<IDBDatabase> | undefined
let pruneTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
const clearListeners = new Set<() => void>()

const openDatabase = async() => {
  if (database) return database
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('values')
      request.result.createObjectStore('metadata', { keyPath: 'key' })
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close()
        if (database === opening) database = undefined
      }
      request.result.onclose = () => { if (database === opening) database = undefined }
      resolve(request.result)
    }
    request.onerror = () => { reject(request.error) }
  })
  database = opening
  void opening.catch(() => { if (database === opening) database = undefined })
  return opening
}

const result = async<T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => { resolve(request.result) }
  request.onerror = () => { reject(request.error) }
})

const completed = async(transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => { resolve() }
  transaction.onabort = () => { reject(transaction.error) }
  transaction.onerror = () => { reject(transaction.error) }
})

export const readArtworkCache = async<T extends Blob | string>(key: string): Promise<T | undefined> => {
  try {
    const db = await openDatabase()
    return await result<T | undefined>(db.transaction('values').objectStore('values').get(key))
  } catch {
    // Storage may be unavailable or full; loading artwork must still work.
    return undefined
  }
}

const prune = async() => {
  pruneTimer = undefined
  try {
    const db = await openDatabase()
    // Only read small metadata records, never all image blobs into memory.
    const transaction = db.transaction(['values', 'metadata'], 'readwrite')
    const done = completed(transaction)
    const metadata = transaction.objectStore('metadata')
    const request = metadata.getAll()
    request.onsuccess = () => {
      const entries: CacheMeta[] = request.result
      let bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
      let count = entries.length
      for (const entry of entries.sort((a, b) => a.time - b.time)) {
        if (bytes <= MAX_BYTES && count <= MAX_ENTRIES) break
        transaction.objectStore('values').delete(entry.key)
        metadata.delete(entry.key)
        bytes -= entry.bytes
        count--
      }
    }
    await done
  } catch { /* Cache maintenance must not interrupt the player. */ }
}

export const artworkCacheGeneration = () => generation

export const writeArtworkCache = async(key: string, value: Blob | string, expectedGeneration = generation) => {
  const bytes = typeof value === 'string' ? value.length * 2 : value.size
  if (!bytes || bytes > MAX_ENTRY_BYTES) return
  try {
    const db = await openDatabase()
    // An in-flight download must not refill a cache the user just cleared.
    if (generation !== expectedGeneration) return
    const transaction = db.transaction(['values', 'metadata'], 'readwrite')
    const done = completed(transaction)
    transaction.objectStore('values').put(value, key)
    transaction.objectStore('metadata').put({ key, bytes, time: Date.now() } satisfies CacheMeta)
    await done
    pruneTimer ??= setTimeout(() => { void prune() }, 2000)
  } catch { /* Network artwork remains usable without a disk cache. */ }
}

export const getArtworkCacheSize = async() => {
  try {
    const db = await openDatabase()
    const entries: CacheMeta[] = await result(db.transaction('metadata').objectStore('metadata').getAll())
    return entries.reduce((total, entry) => total + entry.bytes, 0)
  } catch { return 0 }
}

export const onArtworkCacheCleared = (listener: () => void) => { clearListeners.add(listener) }

export const clearArtworkCache = async() => {
  generation++
  for (const listener of clearListeners) listener()
  clearTimeout(pruneTimer)
  pruneTimer = undefined
  const db = await openDatabase()
  const transaction = db.transaction(['values', 'metadata'], 'readwrite')
  const done = completed(transaction)
  transaction.objectStore('values').clear()
  transaction.objectStore('metadata').clear()
  await done
}
