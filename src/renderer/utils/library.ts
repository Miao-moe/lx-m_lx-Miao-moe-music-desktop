import { rendererInvoke } from '@common/rendererIpc'
import { WIN_MAIN_RENDERER_EVENT_NAME } from '@common/ipcNames'
import { ref } from '@common/utils/vueTools'
import { emptyLibraryPreferences, type LibraryPreferences, type LibraryService } from '@common/library'

type Service = LibraryService
export const libraryCall = async<K extends keyof Service>(method: K, ...args: Parameters<Service[K]>): Promise<Awaited<ReturnType<Service[K]>>> => {
  return rendererInvoke<{ method: K, args: any[] }, Awaited<ReturnType<Service[K]>>>(WIN_MAIN_RENDERER_EVENT_NAME.library_action, { method, args: JSON.parse(JSON.stringify(args)) })
}
export const libraryPreferences = ref<LibraryPreferences>(emptyLibraryPreferences())
export const libraryError = ref('')
export const refreshLibraryPreferences = async() => { libraryPreferences.value = await libraryCall('getLibraryPreferences') }
export const saveLibraryPreferences = async(value: LibraryPreferences) => {
  await libraryCall('saveLibraryPreferences', value)
  libraryPreferences.value = value
}
