// Only NSIS Setup assets can be installed silently. Prefer a matching single-arch
// installer, then the x86/x64 bundle or an installer without an architecture suffix.
export const getWindowsSetupPriority = (fileName: string, arch: string): number => {
  if (!fileName || /[/\\\0]/.test(fileName) || !/(?:^|[-_. ])setup\.exe$/i.test(fileName)) return 0
  const name = fileName.toLowerCase()
  if (/(?:^|[-_. ])(?:portable|green)(?:[-_. ]|$)/.test(name)) return 0
  if (/(?:^|[-_. ])x86_64(?:[-_. ]|$)/.test(name)) return arch == 'x64' || arch == 'ia32' ? 1 : 0
  const architectures = name.match(/(?:^|[-_. ])(x64|x86|ia32|arm64)(?=[-_. ]|$)/g)
  if (!architectures) return 1
  const keyword = arch == 'ia32' ? '(?:x86|ia32)' : arch
  return new RegExp(`(?:^|[-_. ])${keyword}(?:[-_. ]|$)`).test(name) ? 2 : 0
}
