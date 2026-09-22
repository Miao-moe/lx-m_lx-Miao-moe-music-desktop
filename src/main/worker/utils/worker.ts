import { errorForTransport } from '@common/utils/errorMessage'
import worker from 'node:worker_threads'
import * as Comlink from 'comlink'
import nodeEndpoint from 'comlink/dist/esm/node-adapter'


export const exposeWorker = (obj: any) => {
  if (worker.parentPort == null) return
  const methods = Object.fromEntries(Object.entries(obj).map(([name, method]) => [name, typeof method === 'function' ? async(...args: unknown[]) => {
    try { return await method.apply(obj, args) } catch (error) { throw errorForTransport(error) }
  } : method]))
  Comlink.expose(methods, nodeEndpoint(worker.parentPort))
}
