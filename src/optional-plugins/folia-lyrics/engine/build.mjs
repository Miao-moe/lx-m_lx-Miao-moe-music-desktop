import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import tailwind from '@tailwindcss/postcss'
import { patchPausedFumeCamera } from './adapters/pausedCamera.mjs'
import { patchCadenzaLayout } from './adapters/cadenzaLayout.mjs'

// Build a self-contained browser renderer, isolated from the host's Vue and CSS.
const root = path.dirname(fileURLToPath(import.meta.url))
const output = path.resolve(root, '../../../../build/optional-plugins/folia-lyrics/engine')
const adapters = new Map([
  ['src/components/visualizer/VisualizerShell', 'Shell.tsx'],
  ['src/hooks/usePlayerBottomBarBottomPx', 'bottomBar.ts'],
  ['src/services/temperaLayerImages', 'images.ts'],
].map(([source, adapter]) => [path.join(root, 'vendor', source).replaceAll('\\', '/'), path.join(root, 'adapters', adapter).replaceAll('\\', '/')]))
await build({
  root,
  configFile: false,
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@': path.join(root, 'vendor/src') } },
  plugins: [{
    name: 'lx-folia-host-adapters',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return
      return adapters.get(path.resolve(path.dirname(importer), source).replaceAll('\\', '/').replace(/\.(tsx?|jsx?)$/, ''))
    },
    transform(source, id) {
      if (id.replaceAll('\\', '/').endsWith('/visualizer/fume/VisualizerFume.tsx')) return patchPausedFumeCamera(source)
      if (id.replaceAll('\\', '/').endsWith('/visualizer/cadenza/VisualizerCadenza.tsx')) return patchCadenzaLayout(source)
    },
  }],
  css: { postcss: { plugins: [tailwind({ base: root })] } },
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'chrome108',
    lib: { entry: path.join(root, 'main.tsx'), name: 'LXFoliaLyrics', formats: ['iife'], fileName: () => 'engine.js', cssFileName: 'engine' },
  },
})
await fs.writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./engine.css"></head><body><div id="root"></div><script src="./engine.js"></script></body></html>\n')
