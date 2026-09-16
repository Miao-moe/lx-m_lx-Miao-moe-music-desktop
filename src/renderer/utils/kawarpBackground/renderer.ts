import { Kawarp } from '@kawarp/core'

export const createKawarpRenderer = (canvas: HTMLCanvasElement) => {
  let engine: Kawarp | undefined
  let gl: WebGLRenderingContext | null = null
  try {
    // Reuse a low-power context; Kawarp's default requests the discrete GPU.
    gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true, powerPreference: 'low-power' })
    if (!gl || gl.isContextLost()) return null
    // Use the album artwork's own colors, with one consistent flow effect.
    engine = new Kawarp(canvas, { warpIntensity: 0.85, blurPasses: 8, saturation: 1, scale: 1.08, tintIntensity: 0, dithering: 0.006 })
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Kawarp framebuffer unavailable')
  } catch {
    engine?.dispose()
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  const kawarp = engine
  let previous = ''
  return {
    setSource(image: HTMLCanvasElement, duration: number, from?: HTMLCanvasElement) {
      // Zero can give 0 / 0 in Kawarp's transition on the upload frame.
      kawarp.transitionDuration = Math.max(1, duration)
      // Kawarp otherwise starts an interrupted transition from its last target.
      if (from) kawarp.loadImageElement(from)
      kawarp.loadImageElement(image)
      previous = ''
    },
    finishTransition() { kawarp.transitionDuration = 1 },
    draw(width: number, height: number, time: number, transitioning: boolean) {
      // Context loss can precede the DOM event by a frame.
      if (gl.isContextLost()) return
      const inputs = `${width}:${height}:${time}`
      if (!transitioning && previous === inputs) return
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
      // The host owns the clock and frame rate, including pause and reduced motion.
      kawarp.renderFrame(time)
      previous = inputs
    },
    dispose() { kawarp.dispose() },
  }
}
