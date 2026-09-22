import { createKeyedQueue } from '@common/utils/keyedQueue'
// Independent queues: a playlist operation can issue multiple HTTP requests.
export const queuePlaylistSync = createKeyedQueue(2, 6)
export const queuePlatformRequest = createKeyedQueue(2, 6)
