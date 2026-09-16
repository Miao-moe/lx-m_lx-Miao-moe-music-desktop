const Module = require('node:module')

module.exports = () => {
  try {
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
