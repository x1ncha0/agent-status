import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('agentUpdate', {
  subscribe: (callback: (view: unknown) => void) => {
    ipcRenderer.on('update:state', (_event, view) => callback(view));
  },
  act: (action: string) => ipcRenderer.send('update:action', action),
});
