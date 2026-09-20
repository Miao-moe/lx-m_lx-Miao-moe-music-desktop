const { transform } = require('lightningcss-wasm')

// Tailwind 4 emits nesting and modern color functions. Compile these to the
// bundled Chromium version, including fallbacks for colors in CSS variables.
module.exports = function(source) {
  return transform({ filename: this.resourcePath, code: Buffer.from(source), targets: { chrome: 108 << 16 } }).code.toString()
}
