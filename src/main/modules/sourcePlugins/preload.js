import { contextBridge, ipcRenderer } from 'electron'
import cryptojs from 'crypto-js'
import { SOURCE_PLUGIN_IPC as channels } from '@common/sourcePlugin'

contextBridge.exposeInMainWorld('sourceBridge', {
  reply: packet => ipcRenderer.send(channels.reply, packet),
  request: packet => ipcRenderer.invoke(channels.network, packet),
  cancel: id => ipcRenderer.send(channels.cancelNetwork, id),
  md5: value => cryptojs.MD5(String(value)).toString(),
  listen: callback => { ipcRenderer.on(channels.command, (_event, packet) => callback(packet)) },
})
