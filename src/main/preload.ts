import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('agentStatus', {
  get: () => ipcRenderer.invoke('status:get'),
  subscribe: (callback: (states: unknown) => void) => {
    ipcRenderer.on('status:changed', (_event, states) => callback(states));
  },
});
