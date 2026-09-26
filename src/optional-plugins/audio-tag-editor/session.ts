import { reactive } from 'vue'

interface EditorState {
  snapshot: null | { filePath: string, format: string, size: number, revision: string, tags: Record<string, string>, cover: Cover | null }
  tags: Record<string, string>
  cover: Cover | null
  busy: boolean
  error: string
  errorDetail: string
  saved: boolean
  downloadId: string
  active: boolean
  visible: boolean
}

interface Cover { mime: string, data: string | null, size: number }

export const editor = reactive<EditorState>({
  snapshot: null,
  tags: {},
  cover: null,
  busy: false,
  error: '',
  errorDetail: '',
  saved: false,
  downloadId: '',
  active: true,
  visible: false,
})
