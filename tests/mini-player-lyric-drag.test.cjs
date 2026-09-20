const assert = require('node:assert/strict')
const { test } = require('node:test')
const loader = require('./helpers/load-typescript.cjs')

function fixture(t, isWin = false) {
  const listeners = () => {
    const events = new Map()
    return {
      addEventListener(name, fn) { events.set(name, fn) },
      removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name) },
      emit(name, event) { events.get(name)?.(event) },
      count: () => events.size,
    }
  }
  const oldWindow = global.window, oldDocument = global.document
  const window = global.window = { ...listeners(), innerWidth: 450, innerHeight: 300 }
  const document = global.document = listeners()
  t.after(() => { global.window = oldWindow; global.document = oldDocument })
  let unmount, lockChanged
  const calls = [], starts = [], scrolls = [], captures = new Set()
  const setting = { 'desktopLyric.isLock': false }
  const useDrag = loader({
    '@common/utils/vueTools': {
      ref: value => ({ value }),
      onMounted: fn => fn(),
      onBeforeUnmount: fn => { unmount = fn },
      watch: (getter, fn) => { lockChanged = fn },
    },
    '@common/utils': { isWin },
    '@lyric/store/state': { setting },
    '@lyric/utils/ipc': { setWindowBounds: bounds => calls.push(bounds) },
  })('src/renderer-lyric/components/layout/useLyricDrag.js').default
  const drag = useDrag({ onStart: (...coords) => starts.push(coords), onMove: (...coords) => scrolls.push(coords) })
  const surface = {
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture(id) { captures.delete(id); document.emit('lostpointercapture', { pointerId: id }) },
  }
  const event = (values = {}) => ({
    pointerId: 7, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    clientX: 20, clientY: 80, screenX: 200, screenY: 300,
    currentTarget: surface, target: { closest: () => null }, preventDefault() {},
    ...values,
  })
  return { drag, calls, starts, scrolls, captures, window, document, event, unmount: () => unmount(), lock: () => { setting['desktopLyric.isLock'] = true; lockChanged(true) } }
}

test('Windows lyric margins leave all movement to the native caption, without renderer IPC or resizing', t => {
  const f = fixture(t, true)
  f.drag.handleLyricPointerDown(f.event())
  for (let i = 0; i < 50; i++) f.document.emit('pointermove', f.event({ clientX: i * 30, screenX: 200 + i * 10 }))
  assert.deepEqual(f.calls, [])
  assert.equal(f.captures.size, 0)
  assert.equal(f.drag.isMsDown.value, false)
})

test('fallback movement uses incremental screen coordinates even when events queue before the window moves', t => {
  const f = fixture(t)
  f.drag.handleLyricPointerDown(f.event())
  f.document.emit('pointermove', f.event({ screenX: 220, screenY: 310, clientX: 40 }))
  f.document.emit('pointermove', f.event({ screenX: 240, screenY: 320, clientX: 60 }))
  // Delayed window movement changes client coordinates without moving the pointer.
  f.document.emit('pointermove', f.event({ screenX: 240, screenY: 320, clientX: 10, clientY: 15 }))
  f.document.emit('pointermove', f.event({ screenX: 235, screenY: 315, clientX: -5 }))
  assert.deepEqual(f.calls, [
    { x: 20, y: 10, w: 450, h: 300 },
    { x: 20, y: 10, w: 450, h: 300 },
    { x: -5, y: -5, w: 450, h: 300 },
  ])
  assert.equal(f.calls.reduce((total, bounds) => total + bounds.x, 0), 35)
})

test('lyric text and nested translation spans scroll locally without moving the window', t => {
  const f = fixture(t, true)
  let prevented = false
  f.drag.handleLyricPointerDown(f.event({ target: { closest: selector => selector.includes('.font-lrc') ? {} : null }, preventDefault() { prevented = true } }))
  assert.equal(prevented, false, 'clicking text must dismiss keyboard focus in the hidden header')
  assert.equal(f.drag.isMsDown.value, true)
  f.document.emit('pointermove', f.event({ clientX: 40, clientY: 55 }))
  assert.deepEqual(f.starts, [[20, 80]])
  assert.deepEqual(f.scrolls, [[40, 55]])
  assert.deepEqual(f.calls, [])
  f.document.emit('pointerup', f.event())
  assert.equal(f.drag.isMsDown.value, false)
  assert.equal(f.captures.size, 0)
})

for (const reason of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'lock', 'unmount', 'released button']) {
  test(`a drag ends on ${reason} and cannot keep moving the window`, t => {
    const f = fixture(t)
    f.drag.handleLyricPointerDown(f.event())
    if (reason === 'blur') f.window.emit('blur')
    else if (reason === 'lock') f.lock()
    else if (reason === 'unmount') f.unmount()
    else if (reason === 'released button') f.document.emit('pointermove', f.event({ buttons: 0 }))
    else f.document.emit(reason, f.event())
    f.document.emit('pointermove', f.event({ screenX: 400 }))
    assert.deepEqual(f.calls, [])
    assert.equal(f.captures.size, 0)
    if (reason === 'unmount') assert.equal(f.document.count() + f.window.count(), 0)
  })
}

test('right clicks, secondary touches and a locked window cannot begin a drag', t => {
  const f = fixture(t)
  f.drag.handleLyricPointerDown(f.event({ button: 2 }))
  f.drag.handleLyricPointerDown(f.event({ pointerType: 'touch', isPrimary: false }))
  f.lock()
  f.drag.handleLyricPointerDown(f.event())
  f.document.emit('pointermove', f.event({ screenX: 400 }))
  assert.deepEqual(f.calls, [])
  assert.equal(f.captures.size, 0)
})

test('a second pointer cannot move or cancel the active touch drag', t => {
  const f = fixture(t)
  f.drag.handleLyricPointerDown(f.event({ pointerType: 'touch' }))
  f.document.emit('pointermove', f.event({ pointerId: 8, screenX: 900 }))
  f.document.emit('pointerup', f.event({ pointerId: 8 }))
  assert.deepEqual(f.calls, [])
  assert.equal(f.captures.size, 1)
  f.document.emit('pointermove', f.event({ pointerType: 'touch', screenX: 230 }))
  assert.deepEqual(f.calls, [{ x: 30, y: 0, w: 450, h: 300 }])
})
