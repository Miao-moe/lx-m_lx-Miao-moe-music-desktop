const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync('src/renderer/core/player/playbackSession.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
module.exports = window => {
  const exports = {}
  vm.runInNewContext(code, { exports, window, console })
  return exports
}
