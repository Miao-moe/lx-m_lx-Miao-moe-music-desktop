const assert = require('node:assert/strict')
const http = require('node:http')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

const { probeAudioFileSize } = loader()('src/common/utils/audioFileSize.ts')

test('audio size probe reads the exact file length without downloading the file', async() => {
  const requests = []
  const server = http.createServer((request, response) => {
    requests.push([request.url, request.method, request.headers.range])
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/head' }).end()
    } else if (request.url === '/head') {
      response.writeHead(200, { 'Content-Length': '12345678' }).end()
    } else if (request.url === '/range') {
      if (request.method === 'HEAD') response.writeHead(405).end()
      else response.writeHead(206, { 'Content-Range': 'bytes 0-0/87654321', 'Content-Length': '1' }).end('x')
    } else if (request.url === '/ignore-range') {
      if (request.method === 'HEAD') response.writeHead(405).end()
      else response.writeHead(200, { 'Content-Length': '45678901' }).end()
    } else {
      if (request.method === 'HEAD') response.writeHead(405).end()
      else response.writeHead(206, { 'Content-Length': '1' }).end('x')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal(await probeAudioFileSize(`${base}/redirect`, new AbortController().signal), 12345678)
    assert.equal(await probeAudioFileSize(`${base}/range`, new AbortController().signal), 87654321)
    assert.equal(await probeAudioFileSize(`${base}/ignore-range`, new AbortController().signal), 45678901)
    assert.equal(await probeAudioFileSize(`${base}/unknown`, new AbortController().signal), null)
    assert.deepEqual(requests.filter(([path]) => path === '/range').map(([, method, range]) => [method, range]), [
      ['HEAD', undefined], ['GET', 'bytes=0-0'],
    ])
    assert.deepEqual(requests.filter(([path]) => path === '/redirect').map(([, method]) => method), ['HEAD'])
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})

test('audio size probe cancels a stalled response', async() => {
  const server = http.createServer(() => {})
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30)
  try {
    await assert.rejects(probeAudioFileSize(`http://127.0.0.1:${server.address().port}/stalled`, controller.signal), { name: 'AbortError' })
  } finally {
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
