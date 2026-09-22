import { mainHandle } from '@common/mainIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { decodeQrc } from '@common/utils/qrc'

export default () => {
  mainHandle<{ lrc: string, tlrc: string, rlrc: string }, { lyric: string, tlyric: string, rlyric: string }>(WIN_MAIN_RENDERER_EVENT_NAME.handle_tx_decode_lyric, async({ params: { lrc, tlrc, rlrc } }) => {
    const [lyric, tlyric, rlyric] = await Promise.all([decodeQrc(lrc), decodeQrc(tlrc), decodeQrc(rlrc)])
    return { lyric, tlyric, rlyric }
  })
}
