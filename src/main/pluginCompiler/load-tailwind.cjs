const Module = require('node:module')

module.exports = () => {
  const legacyNode = Number(process.versions.node.split('.')[0]) < 18
  // Win7 cannot load current Rust/MSVC binaries. Use the same offline WASM
  // compiler on both x64 and x86, including when tested on a newer Windows host.
  if (legacyNode) {
    const filename = require.resolve('@tailwindcss/oxide')
    const fallback = new Module(filename)
    fallback.filename = filename
    fallback.exports = require('@tailwindcss/oxide-wasm32-wasi')
    fallback.loaded = true
    require.cache[filename] = fallback
  }
  try {
    if (legacyNode) throw Object.assign(new Error('Use the Win7 WASM CSS compiler'), { code: 'ERR_DLOPEN_FAILED' })
    require('lightningcss')
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' && error.code !== 'ERR_DLOPEN_FAILED') throw error
    // Native CSS binaries are unavailable for some supported app architectures.
    // Tailwind's imports must receive the same API from the bundled WASM build.
    const filename = require.resolve('lightningcss')
    const fallback = new Module(filename)
    fallback.filename = filename
    fallback.exports = require('lightningcss-wasm')
    fallback.loaded = true
    require.cache[filename] = fallback
  }
  return require('@tailwindcss/postcss')
}
