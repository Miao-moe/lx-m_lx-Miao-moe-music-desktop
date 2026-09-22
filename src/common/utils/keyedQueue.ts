export const createKeyedQueue = (perKey = 2, total = 6) => {
  const running = new Map<string, number>()
  const waiting: Array<{ key: string, start: () => void }> = []
  let active = 0
  const drain = () => {
    for (let index = 0; index < waiting.length && active < total;) {
      const task = waiting[index]
      if ((running.get(task.key) ?? 0) >= perKey) { index++; continue }
      waiting.splice(index, 1)
      running.set(task.key, (running.get(task.key) ?? 0) + 1); active++
      task.start()
    }
  }
  return async<T>(key: string, action: () => Promise<T>): Promise<T> => new Promise<T>((resolve, reject) => {
    waiting.push({
      key,
      start: () => {
        void Promise.resolve().then(action).then(resolve, reject).finally(() => {
          const count = running.get(key)! - 1
          if (count) running.set(key, count); else running.delete(key)
          active--; drain()
        })
      },
    })
    drain()
  })
}
