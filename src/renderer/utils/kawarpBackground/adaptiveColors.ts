import { type Artwork } from './artwork'
import { artworkColor, compositeBackgrounds, controlRegions, createAdaptivePalette, createControlColors, mixColor, parseColor, rgb, stabilizeColor, type RGB } from './contrast'
import { createControlRegions } from './controlRegions'

interface BackgroundFrame {
  from: Artwork | null
  to: Artwork | null
  mix: number
  opacity: number
}

// Owned by the shared background. No second renderer, cover request or timer.
export const createAdaptiveColors = (background: HTMLElement, themeChanged: () => void) => {
  const root = document.getElementById('root')!
  const controls = createControlRegions(root, background)
  const original = new Map<string, { value: string, priority: string }>()
  const values = new Map<string, string>()
  let enabled = false
  let lastSample = -Infinity
  let darkText: boolean | undefined
  let artwork: RGB | undefined
  let regionColors: RGB[] = []
  let sampler: HTMLCanvasElement | undefined
  let context: CanvasRenderingContext2D | null = null
  const clear = () => {
    for (const [key, { value, priority }] of original) {
      if (value) root.style.setProperty(key, value, priority)
      else root.style.removeProperty(key)
    }
    original.clear()
    values.clear()
    delete root.dataset.ambientControls
    darkText = undefined
    artwork = undefined
    regionColors = []
    lastSample = -Infinity
  }
  const themeObserver = new MutationObserver(() => {
    lastSample = -Infinity
    // Keep the background's shading independent of the foreground palette.
    background.style.setProperty('--ambient-shade-color', getComputedStyle(document.documentElement).getPropertyValue('--color-content-background'))
    // The renderer's gradient follows the theme even when adaptive controls
    // are disabled; static snapshots must be refreshed as well.
    themeChanged()
  })
  const themeStyle = (window as Window & { dom_style?: HTMLStyleElement }).dom_style
  if (themeStyle) themeObserver.observe(themeStyle, { childList: true, characterData: true, subtree: true })

  const write = (key: string, value: string) => {
    if (!original.has(key)) original.set(key, { value: root.style.getPropertyValue(key), priority: root.style.getPropertyPriority(key) })
    if (values.get(key) === value) return
    values.set(key, value)
    root.style.setProperty(key, value)
  }
  const update = (frame: BackgroundFrame, canvas: HTMLCanvasElement | null, moving = false) => {
    if (!enabled || !background.isConnected) return
    const now = performance.now()
    if (now - lastSample < 250) return
    lastSample = now
    sampler ??= document.createElement('canvas')
    if (!context) {
      sampler.width = 24
      sampler.height = 16
      context = sampler.getContext('2d', { willReadFrequently: true })
    }
    if (!context) return
    const styles = getComputedStyle(document.documentElement)
    const base = parseColor(styles.getPropertyValue('--color-surface'))
    const shade = parseColor(styles.getPropertyValue('--color-content-background')).slice(0, 3) as RGB
    background.style.setProperty('--ambient-shade-color', styles.getPropertyValue('--color-content-background'))
    const pixels: RGB[] = []
    try {
      context.clearRect(0, 0, 24, 16)
      // Static presentation hides the live canvas, but its retained pixels are
      // still the exact source of the displayed snapshot and its local colors.
      if (canvas && frame.opacity) context.drawImage(canvas, 0, 0, 24, 16)
      else {
        const rect = background.getBoundingClientRect()
        const width = Math.max(1, rect.width)
        const height = Math.max(1, rect.height)
        // Match the fallback's cover crop, 1.18 scale and 48px blur. Stretching
        // the square artwork would sample the wrong region in a wide window.
        context.filter = `blur(${48 * 1.18 * 24 / width}px)`
        const draw = (artwork: Artwork) => {
          const scale = Math.max(width / artwork.image.width, height / artwork.image.height) * 1.18
          const w = artwork.image.width * scale / width * 24
          const h = artwork.image.height * scale / height * 16
          context!.drawImage(artwork.image, (24 - w) / 2, (16 - h) / 2, w, h)
        }
        const from = frame.from ?? frame.to
        if (from) draw(from)
        if (frame.from && frame.to && frame.from !== frame.to) {
          context.globalAlpha = frame.mix
          draw(frame.to)
          context.globalAlpha = 1
        }
        context.filter = 'none'
      }
      const data = context.getImageData(0, 0, 24, 16).data
      for (let index = 0; index < data.length; index += 4) {
        const color: RGB = [data[index], data[index + 1], data[index + 2]]
        // WebGL already contains the gradient; only CSS fallback needs it here.
        const amount = canvas ? 0 : Math.max(0, ((index / 4 % 24) / 23 - 0.12) / 1.03) * 0.1
        pixels.push(mixColor(color, shade, amount))
      }
    } catch {
      // A lost GPU context must not leave unreadable or stale theme overrides.
      pixels.push(...Array.from({ length: 24 * 16 }, () => base.slice(0, 3) as RGB))
      context.globalAlpha = 1
      context.filter = 'none'
    }
    const opacity = frame.opacity * Number(getComputedStyle(background).opacity)
    const backgrounds = compositeBackgrounds(pixels, base, opacity)
    const currentArtwork = artwork = stabilizeColor(artwork, frame.opacity ? artworkColor(pixels) : [125, 125, 125], moving)
    const palette = createAdaptivePalette(backgrounds, currentArtwork, darkText)
    darkText = palette.darkText
    for (const [key, value] of Object.entries(palette.colors)) write(key, value)
    controlRegions(pixels, 24, 16).forEach((region, index) => {
      const color = regionColors[index] = stabilizeColor(regionColors[index], frame.opacity ? artworkColor(region) : currentArtwork, moving)
      const colors = createControlColors(compositeBackgrounds(region, base, opacity), color, palette)
      write(`--ambient-zone-${index}-accent`, rgb(colors.accent))
      write(`--ambient-zone-${index}-lyric-accent`, rgb(colors.lyricAccent))
      write(`--ambient-zone-${index}-on-accent`, rgb(colors.onAccent))
    })
    root.dataset.ambientControls = darkText ? 'light' : 'dark'
    controls.refresh()
  }
  return {
    update,
    invalidate() { lastSample = -Infinity },
    setEnabled(value: boolean) {
      enabled = value
      controls.setEnabled(value)
      lastSample = -Infinity
      if (!value) clear()
    },
    dispose() {
      themeObserver.disconnect()
      controls.dispose()
      clear()
      background.style.removeProperty('--ambient-shade-color')
      sampler = undefined
      context = null
    },
  }
}
