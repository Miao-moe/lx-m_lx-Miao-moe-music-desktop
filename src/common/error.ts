import { showLoadError } from './loadErrorNotice'
import { log } from './utils'

const ignoreErrorMessage = [
  'Possible side-effect in debug-evaluate',
  'Unexpected end of input',
]

process.on('uncaughtException', err => {
  if (ignoreErrorMessage.includes(err?.message)) return
  console.error('An uncaught error occurred!')
  console.error(err)
  log.error(err)
  showLoadError(err, 'APP_RUNTIME_ERROR')
})
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at: Promise ', p)
  console.error(' reason: ', reason)
  log.error(reason)
  showLoadError(reason, 'APP_LOAD_FAILED')
})

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', event => { showLoadError(event.reason, 'APP_LOAD_FAILED') })
  window.addEventListener('error', event => { if (event.error) showLoadError(event.error, 'APP_RUNTIME_ERROR') })
}
