import { ref, onMounted, onBeforeUnmount, watch } from '@common/utils/vueTools'
import { isWin } from '@common/utils'
import { setting } from '@lyric/store/state'
import { setWindowBounds } from '@lyric/utils/ipc'

export default ({ onStart, onMove }) => {
  const isMsDown = ref(false)
  let drag = null

  const endDrag = () => {
    const previous = drag
    drag = null
    isMsDown.value = false
    if (previous?.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
  }
  const handleLyricPointerDown = event => {
    if (drag || event.button !== 0 || !event.isPrimary || setting['desktopLyric.isLock']) return
    const isLyric = !!event.target.closest('.font-lrc, .extended')
    // Windows moves blank lyric regions natively, just like the title bar.
    // Never queue a second window move from renderer-relative coordinates.
    if (!isLyric && isWin) return
    drag = {
      id: event.pointerId,
      target: event.currentTarget,
      x: event.screenX,
      y: event.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    isMsDown.value = isLyric
    if (isLyric) onStart(event.clientX, event.clientY)
    event.currentTarget.setPointerCapture(event.pointerId)
    // Text clicks must still dismiss keyboard focus in the floating controls.
    if (!isLyric) event.preventDefault()
  }
  const handlePointerMove = event => {
    if (!drag || drag.id !== event.pointerId) return
    if (setting['desktopLyric.isLock'] || (event.pointerType === 'mouse' && !event.buttons)) {
      endDrag()
      return
    }
    if (isMsDown.value) {
      onMove(event.clientX, event.clientY)
    } else {
      // Screen coordinates don't change when the window catches up with IPC.
      // Send only the movement since the previous event, not since pointerdown.
      const x = event.screenX - drag.x
      const y = event.screenY - drag.y
      drag.x = event.screenX
      drag.y = event.screenY
      if (x || y) setWindowBounds({ x, y, w: drag.width, h: drag.height })
    }
  }
  const handlePointerUp = event => {
    if (drag?.id === event.pointerId) endDrag()
  }

  watch(() => setting['desktopLyric.isLock'], locked => { if (locked) endDrag() })
  onMounted(() => {
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
    document.addEventListener('lostpointercapture', handlePointerUp)
    window.addEventListener('blur', endDrag)
  })
  onBeforeUnmount(() => {
    endDrag()
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.removeEventListener('pointercancel', handlePointerUp)
    document.removeEventListener('lostpointercapture', handlePointerUp)
    window.removeEventListener('blur', endDrag)
  })
  return { isMsDown, handleLyricPointerDown }
}
