const assert = require('node:assert/strict')
const { test } = require('node:test')
const { getErrorInfo, formatError, errorForTransport, restoreTransportError, isCancelledError } = require('./helpers/load-typescript.cjs')()('src/common/utils/errorMessage.ts')

test('loading diagnostics preserve system, HTTP, provider and nested error codes', () => {
  for (const [error, expected] of [
    [Object.assign(Error('disk write failed'), { code: 'ENOSPC' }), 'ENOSPC'],
    [Object.assign(Error('unavailable'), { statusCode: 503 }), 'HTTP_503'],
    [Object.assign(Error('business failure'), { code: 20001, statusCode: 200 }), '20001'],
    [new Error('request failed', { cause: Object.assign(Error('connection reset'), { code: 'ECONNRESET' }) }), 'ECONNRESET'],
    [Error('Error invoking remote method \'backup_restore\': Error: backup:invalid:playlist'), 'BACKUP_INVALID'],
    [Error('Artwork HTTP 404'), 'HTTP_404'],
  ]) {
    assert.equal(getErrorInfo(error).code, expected)
    const display = formatError(error)
    assert.match(display, /错误代码/)
    assert.match(display, /原因/)
    assert(display.includes(expected))
  }
})
test('unknown errors provide a code and an honest reason, and aborts remain distinguishable', () => {
  assert.equal(getErrorInfo(null, 'COVER_LOAD_FAILED').code, 'COVER_LOAD_FAILED')
  assert.match(getErrorInfo(null).reason, /未返回具体原因/)
  assert.equal(getErrorInfo(Error('decode failed')).reason, 'decode failed')
  assert(isCancelledError({ name: 'AbortError' }))
  assert(isCancelledError({ message: '取消http请求' }))
  assert(!isCancelledError({ code: 'ETIMEDOUT' }))
})
test('IPC serialization keeps codes and renderer restoration preserves the original message', () => {
  const source = Object.assign(Error('cannot open file'), { code: 'ENOENT' })
  const wire = errorForTransport(source)
  const restored = restoreTransportError(Error(`Error invoking remote method 'read': Error: ${wire.message}`))
  assert.equal(restored.code, 'ENOENT')
  assert.equal(restored.message, source.message)
  assert.equal(getErrorInfo(wire).code, 'ENOENT')
  assert.equal(errorForTransport(errorForTransport(wire)).message, wire.message)
  assert.equal(getErrorInfo(Object.assign(Error('aborted'), { name: 'AbortError' })).code, 'ABORT_ERR')
})
test('visible diagnostics redact URL credentials, query secrets, headers and stack traces', () => {
  const value = formatError(Error('request https://alice:password@example.test/path?token=secret#private failed\nCookie: session=private\nAuthorization: Bearer private\n    at internal (private.js:1:2)'))
  assert(value.includes('example.test/path'))
  for (const secret of ['alice', 'password', 'secret', 'private', 'internal']) assert(!value.includes(secret), value)
})
