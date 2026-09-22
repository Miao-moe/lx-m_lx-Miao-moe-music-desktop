const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

module.exports = function loadSearchSdk(respond) {
  const root = path.resolve('src/renderer/utils')
  const cache = new Map()
  const calls = [], logs = [], waits = []
  let now = Date.now()
  const messages = { cancelRequest: '取消http请求', timeout: '请求超时', notConnectNetwork: '无法连接到服务器', unachievable: '接口无法访问' }
  const request = (url, options = {}) => {
    const call = { url, ...options }
    calls.push(call)
    return { promise: Promise.resolve().then(() => respond(call, calls.length)) }
  }
  const overrides = new Map(Object.entries({
    'request.js': { httpFetch: request },
    'message.js': { requestMsg: messages },
    'index.js': { formatPlayTime: String, sizeFormate: String, formatPlayCount: String, dateFormat: String, decodeName: value => String(value ?? '') },
    'musicSdk/utils.js': { formatSingerName: (singers = [], key = 'name') => singers.map(s => s[key]).join('、'), toMD5: () => 'signature' },
    'musicSdk/kw/util.js': { formatSinger: name => name },
    'musicSdk/mg/songId.js': { default: async info => info.songmid, __esModule: true },
    'musicSdk/tx/utils/index.js': { signRequest: data => request('qq-signed', { data }).promise },
    'musicSdk/wy/utils/index.js': {
      eapiRequest: (url, data) => request(url, { data }),
      weapiRequest: (url, data) => request('/weapi' + url, { data }),
    },
    'musicSdk/wy/utils/crypto.js': { weapi: data => data, linuxapi: data => data },
  }).map(([filename, value]) => [path.join(root, filename), value]))
  const load = filename => {
    if (!path.extname(filename)) filename = overrides.has(filename + '.js') || fs.existsSync(filename + '.js') ? filename + '.js' : path.join(filename, 'index.js')
    if (overrides.has(filename)) return overrides.get(filename)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, URLSearchParams, Buffer, AbortController, AbortSignal,
      Date: class extends Date { static now() { return now } },
      console: { log() {}, warn: (...args) => logs.push(args.join(' ')) },
      setTimeout: (callback, ms) => { if (ms >= 10000) return setTimeout(callback, ms); waits.push(ms); queueMicrotask(callback) },
      clearTimeout,
      require: name => name.startsWith('node:') ? require(name) : load(path.resolve(path.dirname(filename), name)),
    }, { filename })
    return module.exports
  }
  return { load: name => load(path.join(root, name)), sdk: source => load(path.join(root, 'musicSdk', source, 'musicSearch.js')).default, calls, logs, waits, messages, advanceTime: ms => { now += ms } }
}
