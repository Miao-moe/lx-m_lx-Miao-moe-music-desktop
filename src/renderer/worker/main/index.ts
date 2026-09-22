import { exposeWorker } from '../utils/worker'

import * as common from './common'
import * as list from './list'
import * as music from './music'
import * as library from './library'


console.log('hello main worker')


exposeWorker(Object.assign({}, common, list, music, library))

export type workerMainTypes = typeof common
  & typeof list
  & typeof music
  & typeof library
