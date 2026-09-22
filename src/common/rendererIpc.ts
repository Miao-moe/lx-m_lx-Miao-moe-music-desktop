import { ipcRenderer } from 'electron'
import { restoreTransportError } from './utils/errorMessage'
import { createIpcListeners } from './ipcListeners'

const listeners = createIpcListeners(ipcRenderer)

export function rendererSend(name: string): void
export function rendererSend<T>(name: string, params: T): void
export function rendererSend<T>(name: string, params?: T): void {
  ipcRenderer.send(name, params)
}

export function rendererSendSync(name: string): void
export function rendererSendSync<T>(name: string, params: T): void
export function rendererSendSync<T>(name: string, params?: T): void {
  ipcRenderer.sendSync(name, params)
}

export async function rendererInvoke(name: string): Promise<void>
export async function rendererInvoke<V>(name: string): Promise<V>
export async function rendererInvoke<T>(name: string, params: T): Promise<void>
export async function rendererInvoke<T, V>(name: string, params: T): Promise<V>
export async function rendererInvoke <T, V>(name: string, params?: T): Promise<V> {
  try { return await ipcRenderer.invoke(name, params) } catch (error) { throw restoreTransportError(error) }
}

export function rendererOn(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOn<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  listeners.on(name, listener)
}

export function rendererOnce(name: string, listener: LX.IpcRendererEventListener): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void
export function rendererOnce<T>(name: string, listener: LX.IpcRendererEventListenerParams<T>): void {
  listeners.on(name, listener, true)
}

export const rendererOff = (name: string, listener: (...args: any[]) => any) => {
  listeners.off(name, listener)
}

export const rendererOffAll = (name: string) => {
  listeners.offAll(name)
}
