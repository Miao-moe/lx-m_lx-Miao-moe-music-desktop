// Reuse measurements and text nodes while the current line's prepared layout is
// unchanged. Keep upstream sources intact and apply this to both build paths.
export const patchCadenzaLayout = source => {
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('Folia Cadenza layout hook changed: ' + before.trim())
    source = source.replace(before, after)
  }
  replace("        if (!textContext) return;", `        if (!textContext) return;
        const textMetricsCache = new Map<string, TextMetrics>();
        const clearTextMetrics = () => textMetricsCache.clear();
        document.fonts.addEventListener('loadingdone', clearTextMetrics);
        const measureOverlayText = (text: string) => {
            let metrics = textMetricsCache.get(text);
            if (!metrics) {
                metrics = textContext.measureText(text);
                textMetricsCache.set(text, metrics);
            }
            return metrics;
        };`)
  replace('const textMetrics = textContext.measureText(placement.text);', 'const textMetrics = measureOverlayText(placement.text);')
  replace('            lastFrameTimeRef.current = null;', `            document.fonts.removeEventListener('loadingdone', clearTextMetrics);
            lastFrameTimeRef.current = null;`)
  replace('                overlayWord.body.textContent = placement.text;', '                if (overlayWord.body.textContent !== placement.text) overlayWord.body.textContent = placement.text;')
  return source
}
