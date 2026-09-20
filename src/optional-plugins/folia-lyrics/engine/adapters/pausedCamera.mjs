// A newly mounted, paused Fume renderer cannot advance its camera transition.
// Snap its camera on a paused draw so opening/seeking lyrics remains readable.
// Keep the imported source unchanged and fail clearly if the upstream hook moves.
export const patchPausedFumeCamera = source => {
  const anchor = '            const cameraDistance = Math.hypot('
  const drawAnchor = '        draw();\n        return () => {\n            window.cancelAnimationFrame(frameId);\n            lastFrameAt = null;'.replaceAll('\n', source.includes('\r\n') ? '\r\n' : '\n')
  const dependencyAnchor = '        textHoldRatio,\n        theme,\n        viewport.height,'.replaceAll('\n', source.includes('\r\n') ? '\r\n' : '\n')
  if (source.split(anchor).length !== 2) throw new Error('Folia Fume paused-camera hook changed')
  // Paused seeks must redraw directly; an unchanged theme no longer restarts the effect.
  if (source.split(drawAnchor).length !== 2) throw new Error('Folia Fume paused-draw hook changed')
  if (source.split(dependencyAnchor).length !== 2) throw new Error('Folia Fume paused-line hook changed')
  return source.replace(dependencyAnchor, `        textHoldRatio,
        paused ? currentLineIndex : null,
        theme,
        viewport.height,`).replace(drawAnchor, `        const unsubscribeTime = paused ? currentTime.on('change', () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                lastFrameAt = null;
                draw();
            });
        }) : undefined;
        draw();
        return () => {
            unsubscribeTime?.();
            window.cancelAnimationFrame(frameId);
            lastFrameAt = null;`).replace(anchor, `            if (paused) {
                Object.assign(cameraRef.current, {
                    x: targetCameraX, y: targetCameraY, scale: targetCameraScale,
                    focusX: targetCameraX, focusY: targetCameraY, focusScale: targetCameraScale,
                    velocityX: 0, velocityY: 0, velocityScale: 0,
                });
                cameraRetargetRef.current.bridgeMode = 'none';
            }

${anchor}`)
}
