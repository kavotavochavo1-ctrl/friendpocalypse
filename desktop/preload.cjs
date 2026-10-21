const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('FP_STEAM', {
  call: (method, data) => ipcRenderer.invoke('steam:call', method, data),
  onEvent: handler => { const listener = (_, data) => handler(data); ipcRenderer.on('steam:event', listener); return () => ipcRenderer.removeListener('steam:event', listener); }
});
