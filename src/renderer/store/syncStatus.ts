import { reactive } from '@common/utils/vueTools'
import { formatError } from '@common/utils/errorMessage'
export interface SyncStatus { label: string, state: 'running' | 'success' | 'failed' | 'idle', time: number, lastSuccess?: number, error?: string, completed?: number, total?: number }
const storageKey = 'lx-sync-status-v1'
const read = (): Record<string, SyncStatus> => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}')
    return Object.fromEntries(Object.entries(saved).slice(0, 200).filter(([, value]: any) => value && typeof value.label === 'string' && typeof value.time === 'number').map(([key, value]: any) => [key, { ...value, ...(value.state === 'running' ? { state: 'failed', error: formatError({ code: 'SYNC_INTERRUPTED', message: '上次同步未完成，请重试' }) } : {}) }]))
  } catch { return {} }
}
export const syncStatuses = reactive<Record<string, SyncStatus>>(read())
const persist = () => {
  const recent = Object.entries(syncStatuses).sort((a, b) => b[1].time - a[1].time)
  for (const [key] of recent.slice(200)) Reflect.deleteProperty(syncStatuses, key)
  try { window.localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(recent.slice(0, 200)))) } catch { /* Status remains visible for this session. */ }
}
export const beginSync = (key: string, label: string, total?: number) => {
  syncStatuses[key] = { label, state: 'running', time: Date.now(), lastSuccess: syncStatuses[key]?.lastSuccess, completed: 0, total }
  persist()
}
export const progressSync = (key: string, completed: number, total?: number) => { if (syncStatuses[key]) Object.assign(syncStatuses[key], { completed, ...(total === undefined ? {} : { total }) }) }
export const finishSync = (key: string, error?: unknown, successTime?: number) => {
  const current = syncStatuses[key]
  if (!current) return
  current.time = Date.now(); current.state = error ? 'failed' : 'success'
  current.error = error ? formatError(error, '同步失败', 'SYNC_FAILED') : undefined
  if (!error) current.lastSuccess = successTime ?? current.time
  persist()
}
export const recordSync = (key: string, value: SyncStatus) => { syncStatuses[key] = value; persist() }
