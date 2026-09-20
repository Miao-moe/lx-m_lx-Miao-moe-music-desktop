import { ref, onMounted, onBeforeUnmount, watch, nextTick } from '@common/utils/vueTools'
import { scrollXRTo } from '@common/utils/renderer'
import { lyric } from '@lyric/store/lyric'
import { isPlay, setting } from '@lyric/store/state'
import useLyricDrag from '../useLyricDrag'

const getOffsetTop = (contentWidth, lineWidth) => {
  switch (setting['desktopLyric.scrollAlign']) {
    case 'top': return contentWidth - lineWidth - 2
    default: return contentWidth * 0.5 - lineWidth / 2
  }
}

export default (isComputeWidth) => {
  const dom_lyric = ref(null)
  const dom_lyric_text = ref(null)
  let isStopScroll = false

  let msDownX = 0
  let msDownScrollX = 0
  let timeout = null
  let cancelScrollFn
  let dom_lines
  let line_widths
  let isSetedLines = false
  let prevActiveLine = 0


  const handleScrollLrc = (duration = 300) => {
    if (!dom_lines?.length || !dom_lyric.value) return
    if (isStopScroll) return
    let dom_p = dom_lines[lyric.line]
    let target = 0

    if (dom_p) {
      let offset = 0
      if (isComputeWidth.value) {
        let prevLineWidth = line_widths[prevActiveLine] ?? 0
        offset = prevActiveLine < lyric.line ? ((dom_lines[prevActiveLine]?.clientWidth ?? 0) - prevLineWidth) : 0
        // console.log(prevActiveLine, dom_lines[prevActiveLine]?.clientHeight ?? 0, prevLineWidth, offset)
      }
      target = dom_p.offsetLeft + offset - getOffsetTop(dom_lyric.value.clientWidth, dom_p.clientWidth)
    }
    // A layout change needs an immediate position; the animation helper divides by its duration.
    if (duration === 0) dom_lyric.value.scrollLeft = target
    else cancelScrollFn = scrollXRTo(dom_lyric.value, target, duration)
  }
  const clearLyricScrollTimeout = () => {
    if (!timeout) return
    clearTimeout(timeout)
    timeout = null
  }
  const startLyricScrollTimeout = () => {
    clearLyricScrollTimeout()
    timeout = setTimeout(() => {
      timeout = null
      isStopScroll = false
      if (!isPlay.value) return
      handleScrollLrc()
    }, 3000)
  }

  const { isMsDown, handleLyricPointerDown } = useLyricDrag({
    onStart: (x) => {
      if (delayScrollTimeout) {
        clearTimeout(delayScrollTimeout)
        delayScrollTimeout = null
      }
      msDownX = x
      msDownScrollX = dom_lyric.value.scrollLeft
    },
    onMove: (x) => {
      isStopScroll ||= true
      if (cancelScrollFn) {
        cancelScrollFn()
        cancelScrollFn = null
      }
      dom_lyric.value.scrollLeft = msDownScrollX + msDownX - x
      startLyricScrollTimeout()
    },
  })

  const handleWheel = (event) => {
    console.log(event.deltaY)
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    dom_lyric.value.scrollLeft = dom_lyric.value.scrollLeft - event.deltaY
    startLyricScrollTimeout()
  }

  const setLyric = (lines) => {
    const currentLine = lyric.line
    const previousLine = dom_lines?.[currentLine]
    const lineOffset = previousLine && dom_lyric.value && previousLine.time == lines[currentLine]?.time
      ? previousLine.offsetLeft - dom_lyric.value.scrollLeft
      : null
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    const dom_line_content = document.createDocumentFragment()
    for (const line of lines) {
      dom_line_content.appendChild(line.dom_line)
    }
    dom_lyric_text.value.textContent = ''
    dom_lyric_text.value.appendChild(dom_line_content)
    nextTick(() => {
      dom_lines = dom_lyric.value.querySelectorAll('.line-content')
      line_widths = Array.from(dom_lines).map(l => l.clientWidth)
      const currentLineDom = dom_lines[currentLine]
      if (lineOffset != null && currentLineDom) {
        dom_lyric.value.scrollLeft = currentLineDom.offsetLeft - lineOffset
      } else {
        handleScrollLrc()
      }
      isSetedLines = false
    })
  }

  const initLrc = (lines, oLines) => {
    prevActiveLine = 0
    isSetedLines = true
    if (oLines) {
      if (lines.length) {
        setLyric(lines)
      } else {
        cancelScrollFn = scrollXRTo(dom_lyric.value, 0, 300, () => {
          if (lyric.lines !== lines) return
          setLyric(lines)
        }, 50)
      }
    } else {
      setLyric(lines)
    }
  }

  let delayScrollTimeout
  const scrollLine = (line, oldLine) => {
    setImmediate(() => {
      prevActiveLine = line
    })
    if (line < 0) return
    if (isSetedLines) return
    if (oldLine == null || line - oldLine != 1) return handleScrollLrc()

    if (setting['desktopLyric.isDelayScroll']) {
      delayScrollTimeout = setTimeout(() => {
        delayScrollTimeout = null
        handleScrollLrc(600)
      }, 600)
    } else {
      handleScrollLrc()
    }
  }

  watch(() => lyric.lines, initLrc)
  watch(() => lyric.line, scrollLine)

  const updateLayout = () => {
    line_widths = Array.from(dom_lines ?? []).map(line => line.clientWidth)
    cancelScrollFn?.()
    handleScrollLrc(0)
  }
  const resizeObserver = new window.ResizeObserver(updateLayout)
  watch(() => [setting['desktopLyric.style.fontSize'], setting['desktopLyric.style.lineGap'], setting['desktopLyric.scrollAlign']], () => { nextTick(updateLayout) })

  onMounted(() => {
    initLrc(lyric.lines, null)
    resizeObserver.observe(dom_lyric.value)
  })

  onBeforeUnmount(() => {
    resizeObserver.disconnect()
    clearLyricScrollTimeout()
    clearTimeout(delayScrollTimeout)
    cancelScrollFn?.()
  })

  return {
    dom_lyric,
    dom_lyric_text,
    isMsDown,
    handleLyricPointerDown,
    handleWheel,
  }
}
