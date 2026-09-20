import { ref, onMounted, onBeforeUnmount, watch, nextTick } from '@common/utils/vueTools'
import { scrollTo } from '@common/utils/renderer'
import { lyric } from '@lyric/store/lyric'
import { isPlay, setting } from '@lyric/store/state'
import useLyricDrag from '../useLyricDrag'

const getOffsetTop = (contentHeight, lineHeight) => {
  switch (setting['desktopLyric.scrollAlign']) {
    case 'top': return 0
    default: return contentHeight * 0.5 - lineHeight / 2
  }
}

export default (isComputeHeight) => {
  const dom_lyric = ref(null)
  const dom_lyric_text = ref(null)
  let isStopScroll = false

  let msDownY = 0
  let msDownScrollY = 0
  let timeout = null
  let cancelScrollFn
  let dom_lines
  let line_heights
  let isSetedLines = false
  let prevActiveLine = 0


  const handleScrollLrc = (duration = 300) => {
    if (!dom_lines?.length || !dom_lyric.value) return
    if (isStopScroll) return
    let dom_p = dom_lines[lyric.line]
    let target = 0

    if (dom_p) {
      let offset = 0
      if (isComputeHeight.value) {
        let prevLineHeight = line_heights[prevActiveLine] ?? 0
        offset = prevActiveLine < lyric.line ? ((dom_lines[prevActiveLine]?.clientHeight ?? 0) - prevLineHeight) : 0
        // console.log(prevActiveLine, dom_lines[prevActiveLine]?.clientHeight ?? 0, prevLineHeight, offset)
      }
      target = dom_p.offsetTop - offset - getOffsetTop(dom_lyric.value.clientHeight, dom_p.clientHeight)
    }
    // A layout change needs an immediate position; the animation helper divides by its duration.
    if (duration === 0) dom_lyric.value.scrollTop = target
    else cancelScrollFn = scrollTo(dom_lyric.value, target, duration)
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
    onStart: (_x, y) => {
      if (delayScrollTimeout) {
        clearTimeout(delayScrollTimeout)
        delayScrollTimeout = null
      }
      msDownY = y
      msDownScrollY = dom_lyric.value.scrollTop
    },
    onMove: (_x, y) => {
      isStopScroll ||= true
      if (cancelScrollFn) {
        cancelScrollFn()
        cancelScrollFn = null
      }
      dom_lyric.value.scrollTop = msDownScrollY + msDownY - y
      startLyricScrollTimeout()
    },
  })

  const handleWheel = (event) => {
    console.log(event.deltaY)
    if (cancelScrollFn) {
      cancelScrollFn()
      cancelScrollFn = null
    }
    dom_lyric.value.scrollTop = dom_lyric.value.scrollTop + event.deltaY
    startLyricScrollTimeout()
  }

  const setLyric = (lines) => {
    const currentLine = lyric.line
    const previousLine = dom_lines?.[currentLine]
    const lineOffset = previousLine && dom_lyric.value && previousLine.time == lines[currentLine]?.time
      ? previousLine.offsetTop - dom_lyric.value.scrollTop
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
      line_heights = Array.from(dom_lines).map(l => l.clientHeight)
      const currentLineDom = dom_lines[currentLine]
      if (lineOffset != null && currentLineDom) {
        dom_lyric.value.scrollTop = currentLineDom.offsetTop - lineOffset
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
        cancelScrollFn = scrollTo(dom_lyric.value, 0, 300, () => {
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
    if (line < 0 || !lyric.lines.length) return
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
    line_heights = Array.from(dom_lines ?? []).map(line => line.clientHeight)
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
