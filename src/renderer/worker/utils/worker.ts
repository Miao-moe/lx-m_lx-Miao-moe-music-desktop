import { errorForTransport } from '@common/utils/errorMessage'
import * as Comlink from 'comlink'


export const exposeWorker = (obj: any) => {
  const methods = Object.fromEntries(Object.entries(obj).map(([name, method]) => [name, typeof method === 'function' ? async(...args: unknown[]) => {
    try { return await method.apply(obj, args) } catch (error) { throw errorForTransport(error) }
  } : method]))
  Comlink.expose(methods)
}
