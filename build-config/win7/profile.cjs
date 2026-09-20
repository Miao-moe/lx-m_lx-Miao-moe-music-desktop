const electron = '22.3.27'

// The compiler is shipped with the application and also runs under Node 16.
// Build-only tools still run on the build machine's Node 22 or newer.
const dependencies = {
  'better-sqlite3': '9.6.0',
  'music-metadata': '8.3.0',
  undici: '5.29.0',
  'playwright-core': '1.29.2',
  webpack: '5.99.9',
  'css-loader': '6.11.0',
  'less-loader': '11.1.4',
  less: '4.2.2',
  'postcss-loader': '7.3.4',
  '@tailwindcss/postcss': '4.1.18',
}

const createManifest = (source, lock) => {
  const manifest = JSON.parse(JSON.stringify(source))
  for (const group of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(manifest[group])) {
      // Preserve git dependencies; freeze registry packages to the main lockfile.
      if (!/^(?:github:|git\+|https?:|file:)/.test(range)) manifest[group][name] = lock.packages['node_modules/' + name]?.version ?? range
    }
  }
  Object.assign(manifest.dependencies, dependencies)
  manifest.devDependencies.electron = electron
  manifest.devDependencies['webpack-cli'] = '6.0.1'
  manifest.overrides.minimatch = '9.0.5'
  manifest.overrides['node-releases'] = '2.0.19'
  // metadata 8 expects Buffer tokens; strtok3 7.1 switched them to Uint8Array.
  manifest.overrides.strtok3 = '7.0.0'
  manifest.browserslist = ['Chrome 108']
  manifest.lxBuildTarget = 'win7'
  return manifest
}

module.exports = { electron, dependencies, createManifest }
