import { Worker as NodeWorker } from 'node:worker_threads'
import * as Comlink from 'comlink'
import nodeEndpoint from 'comlink/dist/esm/node-adapter'
import path from 'node:path'

export type DBSeriveTypes = Comlink.Remote<LX.WorkerDBSeriveListTypes>

export const createDBServiceWorker = () => {
  const worker = new NodeWorker(path.join(__dirname, 'dbService.worker.js'))
  return Comlink.wrap<LX.WorkerDBSeriveListTypes>(nodeEndpoint(worker))
}

