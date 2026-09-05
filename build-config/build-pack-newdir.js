/* eslint-disable no-template-curly-in-string */

const builder = require('electron-builder')
const beforePack = require('./build-before-pack')
const afterPack = require('./build-after-pack')

builder.build({
  win: ['nsis'],
  publish: 'never',
  x64: true,
  config: {
    appId: 'com.lx-m.music.desktop',
    productName: 'LX-M Music',
    beforePack,
    afterPack,
    directories: {
      buildResources: './resources',
      output: './build',
    },
    files: [
      'dist/**/*',
      '!node_modules/**/*',
      'node_modules/font-list',
      'node_modules/better-sqlite3/lib',
      'node_modules/better-sqlite3/package.json',
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'node_modules/electron-font-manager/index.js',
      'node_modules/electron-font-manager/package.json',
      'node_modules/electron-font-manager/build/Release/font_manager.node',
      'node_modules/playwright-core',
      'build/Release/qrc_decode.node',
    ],
    asar: { smartUnpack: false },
    asarUnpack: [
      'node_modules/playwright-core/**/*',
      'node_modules/better-sqlite3/**/*',
      'node_modules/electron-font-manager/**/*',
      '**/*.node',
    ],
    extraResources: ['./licenses'],
    win: {
      icon: './resources/icons/icon.ico',
      legalTrademarks: 'lyswhut',
      artifactName: '${productName}-v${version}-x64-Setup.${ext}',
    },
    nsis: {
      oneClick: false,
      language: '2052',
      allowToChangeInstallationDirectory: true,
      license: './licenses/license.rtf',
      shortcutName: 'LX-M Music',
      artifactName: '${productName}-v${version}-x64-Setup.${ext}',
    },
    protocols: {
      name: 'lx-m-music-protocol',
      schemes: ['lxmmusic'],
    },
  },
}).then(() => {
  console.log('BUILD SUCCESS')
}).catch(err => {
  console.error('BUILD FAILED:', err.message)
  process.exit(1)
})
