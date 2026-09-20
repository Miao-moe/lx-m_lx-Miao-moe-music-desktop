const assert = require('node:assert/strict')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')

// Ask the actual Windows window procedure whether a point is a caption or a
// client control. This doesn't move the user's system pointer or send clicks.
async function nativeHitTest(app, page, selector, position = { x: 10, y: 5 }) {
  const rect = await page.locator(selector).first().boundingBox()
  assert(rect)
  const window = await app.browserWindow(page)
  let info
  try {
    info = await window.evaluate(window => ({ handle: window.getNativeWindowHandle().readBigUInt64LE().toString(), bounds: window.getContentBounds() }))
  } finally { await window.dispose() }
  const point = await app.evaluate(({ screen }, { info, rect, position }) => screen.dipToScreenPoint({ x: Math.round(info.bounds.x + rect.x + position.x), y: Math.round(info.bounds.y + rect.y + position.y) }), { info, rect, position })
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeHitTest {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
$null = [NativeHitTest]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$result = [UIntPtr]::Zero
$point = [IntPtr]::new(((${point.y} -band 65535) -shl 16) -bor (${point.x} -band 65535))
$sent = [NativeHitTest]::SendMessageTimeout([IntPtr]::new([long]${info.handle}), 132, [IntPtr]::Zero, $point, 2, 3000, [ref]$result)
if ($sent -eq [IntPtr]::Zero) { throw 'Native window hit test timed out.' }
[Console]::WriteLine($result.ToUInt64())
`], { windowsHide: true, timeout: 10000 })
  return Number(stdout.trim())
}

// Read the real click-through flag, without moving the system pointer.
async function nativeIgnoresMouse(app, page) {
  const window = await app.browserWindow(page)
  let handle
  try { handle = await window.evaluate(window => window.getNativeWindowHandle().readBigUInt64LE().toString()) } finally { await window.dispose() }
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeInputStyle {
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern int GetWindowLong(IntPtr window, int index);
}
'@
$style = [NativeInputStyle]::GetWindowLong([IntPtr]::new([long]${handle}), -20)
[Console]::WriteLine(($style -band 32) -ne 0)
`], { windowsHide: true, timeout: 10000 })
  return stdout.trim().toLowerCase() === 'true'
}

async function prepareNativeBounds(handle, point) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeMove {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
}
'@
$null = [NativeMove]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$targetWindow = [IntPtr]::new([long]${handle})
$before = New-Object NativeMove+Rect
$after = New-Object NativeMove+Rect
$null = [NativeMove]::GetWindowRect($targetWindow, [ref]$before)
[Console]::WriteLine('ready')
if ([Console]::ReadLine() -eq 'move') {
  if (![NativeMove]::SetWindowPos($targetWindow, [IntPtr]::Zero, ${point.x}, ${point.y}, ${point.width ?? 0}, ${point.height ?? 0}, ${point.width == null ? 21 : 20})) { throw 'Native bounds change failed.' }
}
$null = [NativeMove]::GetWindowRect($targetWindow, [ref]$after)
[Console]::WriteLine((@{ width = $after.Right - $after.Left; height = $after.Bottom - $after.Top; expectedWidth = $before.Right - $before.Left; expectedHeight = $before.Bottom - $before.Top } | ConvertTo-Json -Compress))
`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = '', errors = '', readyResolve
  const ready = new Promise(resolve => { readyResolve = resolve })
  child.stdout.on('data', data => { output += data; if (output.includes('ready')) readyResolve() })
  child.stderr.on('data', data => { errors += data })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', code => {
      if (code !== 0) { reject(new Error(errors || `Native move exited with ${code}`)); return }
      try { resolve(JSON.parse(output.trim().split(/\r?\n/).at(-1))) } catch (error) { reject(error) }
    })
  })
  await Promise.race([ready, done])
  return { run: prevented => { child.stdin.end(prevented ? 'skip\n' : 'move\n'); return done }, cancel: () => { if (!child.stdin.writableEnded) child.stdin.end('skip\n') } }
}

// Exercise the native move path without global mouse input. Keep the physical
// size fixed like a system drag: Electron.setPosition can round fractional-DPI
// bounds and resize the window, which is not how a real caption drag works.
async function dragWindow(app, page, selector, { dx = 60, dy = 40, stallRenderer = false, position = { x: 10, y: 5 } } = {}) {
  if (process.platform !== 'win32') {
    const rect = await page.locator(selector).boundingBox()
    await page.mouse.move(rect.x + position.x, rect.y + position.y)
    await page.mouse.down()
    await page.mouse.move(rect.x + position.x + dx, rect.y + position.y + dy, { steps: 5 })
    await page.mouse.up()
    return
  }
  const rect = await page.locator(selector).boundingBox()
  assert(rect)
  await page.mouse.move(rect.x + position.x, rect.y + position.y)
  assert.equal(await nativeHitTest(app, page, selector, position), 2, 'Windows recognizes the drag surface as a native caption')
  const window = await app.browserWindow(page)
  let driver
  try {
    const original = await window.evaluate(window => window.getBounds())
    const handle = await window.evaluate(window => window.getNativeWindowHandle().readBigUInt64LE().toString())
    const point = await app.evaluate(({ screen }, { original, dx, dy }) => screen.dipToScreenPoint({ x: original.x + dx, y: original.y + dy }), { original, dx, dy })
    driver = await prepareNativeBounds(handle, point)
    let stalled = false
    const stall = stallRenderer ? page.evaluate(() => {
      const end = performance.now() + 1200
      while (performance.now() < end) { /* Simulate a busy lyric renderer. */ }
    }).then(() => { stalled = true }) : Promise.resolve()
    const prevented = await window.evaluate((window, { dx, dy }) => {
      const bounds = window.getBounds()
      const target = { ...bounds, x: bounds.x + dx, y: bounds.y + dy }
      let prevented = false
      window.emit('will-move', { preventDefault() { prevented = true } }, target)
      return prevented
    }, { dx, dy })
    const size = await driver.run(prevented)
    const moved = await window.evaluate(window => window.getBounds())
    if (stallRenderer) assert.equal(stalled, false, 'native movement completes without waiting for the renderer')
    await stall
    return { ...size, x: moved.x - original.x, y: moved.y - original.y, expectedX: dx, expectedY: dy }
  } finally { driver?.cancel(); await window.dispose() }
}

async function resizeWindow(app, page, bounds, edge = 'bottom-right') {
  const window = await app.browserWindow(page)
  let driver
  try {
    const info = await window.evaluate(window => ({ id: window.id, handle: window.getNativeWindowHandle().readBigUInt64LE().toString() }))
    const rectangle = await app.evaluate(({ screen, BrowserWindow }, { id, bounds }) => screen.dipToScreenRect(BrowserWindow.fromId(id), bounds), { id: info.id, bounds })
    driver = await prepareNativeBounds(info.handle, rectangle)
    const prevented = await window.evaluate((window, { bounds, edge }) => {
      let prevented = false
      window.emit('will-resize', { preventDefault() { prevented = true } }, bounds, { edge })
      return prevented
    }, { bounds, edge })
    await driver.run(prevented)
    assert.equal(prevented, false)
    return await window.evaluate(window => {
      window.emit('resized')
      return window.getBounds()
    })
  } finally { driver?.cancel(); await window.dispose() }
}

module.exports = { dragWindow, nativeHitTest, nativeIgnoresMouse, resizeWindow }
