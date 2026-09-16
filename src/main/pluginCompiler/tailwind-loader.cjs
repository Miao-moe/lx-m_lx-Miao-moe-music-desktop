const path = require('node:path')
module.exports = source => source.replace(/@import\s+["']tailwindcss["'];/g, () => {
  const css = path.join(path.dirname(require.resolve('tailwindcss/package.json')), 'index.css').replaceAll('\\', '/')
  return `@import "${css}";`
})
