import { errorForTransport } from './utils/errorMessage'
import { ipcMain } from 'electron'
import { createIpcListeners } from './ipcListeners'
import { assertIpcRequest } from '../main/utils/ipcPolicy'

const listeners = createIpcListeners(ipcMain, (event, name, params) => {
  try { assertIpcRequest(event, name, params); return true } catch (error) { console.warn('IPC rejected:', error); return false }
})

export function mainOn(name: string, listener: LX.IpcMainEventListener): void
export function mainOn<T>(name: string, listener: LX.IpcMainEventListenerParams<T>): void
export function mainOn<T>(name: string, listener: LX.IpcMainEventListenerParams<T>): void {
  listeners.on(name, listener)
}

export function mainOnce(name: string, listener: LX.IpcMainEventListener): void
export function mainOnce<T>(name: string, listener: LX.IpcMainEventListenerParams<T>): void
export function mainOnce<T>(name: string, listener: LX.IpcMainEventListenerParams<T>): void {
  listeners.on(name, listener, true)
}

export const mainOff = (name: string, listener: (...args: any[]) => void) => {
  listeners.off(name, listener)
}

export const mainOffAll = (name: string) => {
  listeners.offAll(name)
}

export function mainHandle(name: string, listener: LX.IpcMainInvokeEventListener): void
export function mainHandle<T>(name: string, listener: LX.IpcMainInvokeEventListenerParams<T>): void
export function mainHandle<V>(name: string, listener: LX.IpcMainInvokeEventListenerValue<V>): void
export function mainHandle<T, V>(name: string, listener: LX.IpcMainInvokeEventListenerParamsValue<T, V>): void
export function mainHandle<T, V>(name: string, listener: LX.IpcMainInvokeEventListenerParamsValue<T, V>): void {
  ipcMain.handle(name, async(event, params) => {
    try { assertIpcRequest(event, name, params); return await listener({ event, params }) } catch (error) { throw errorForTransport(error) }
  })
}

export function mainHandleOnce(name: string, listener: LX.IpcMainInvokeEventListener): void
export function mainHandleOnce<T>(name: string, listener: LX.IpcMainInvokeEventListenerParams<T>): void
export function mainHandleOnce<V>(name: string, listener: LX.IpcMainInvokeEventListenerValue<V>): void
export function mainHandleOnce<T, V>(name: string, listener: LX.IpcMainInvokeEventListenerParamsValue<T, V>): void
export function mainHandleOnce<T, V>(name: string, listener: LX.IpcMainInvokeEventListenerParamsValue<T, V>): void {
  ipcMain.handle(name, async(event, params) => {
    try {
      assertIpcRequest(event, name, params)
      ipcMain.removeHandler(name)
      return await listener({ event, params })
    } catch (error) { throw errorForTransport(error) }
  })
}
export const mainHandleRemove = (name: string) => {
  ipcMain.removeHandler(name)
}

export function mainSend(window: Electron.BrowserWindow, name: string): void
export function mainSend<T>(window: Electron.BrowserWindow, name: string, params: T): void
export function mainSend<T>(window: Electron.BrowserWindow, name: string, params?: T): void {
  window.webContents.send(name, params)
}
