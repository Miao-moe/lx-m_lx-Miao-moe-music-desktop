import { reactive } from 'vue'

interface EditorState {
  snapshot: null | { filePath: string, format: string, size: number, revision: string, tags: Record<string, string> }
  tags: Record<string, string>
  busy: boolean
  error: string
  saved: boolean
}

export const editor = reactive<EditorState>({
  snapshot: null,
  tags: {},
  busy: false,
  error: '',
  saved: false,
})
