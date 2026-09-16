const versionHeading = /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/i

// Keep Release bodies intact; only compact the text shown in the app.
export const formatChangeLog = (desc = '', version = '') => {
  const lines = desc.split(/\r\n?|\n/)
    .map(line => line.replace(/^[ \t]*#{1,6}(?:[ \t]+|$)/, ''))
    .filter(line => line.trim())

  if (version && !versionHeading.test(lines[0]?.trim() ?? '')) {
    lines.unshift(`v${version.replace(/^v/i, '')}`)
  }

  return lines.map((line, index) => {
    return index && versionHeading.test(line.trim()) ? `\n${line}` : line
  }).join('\n')
}
