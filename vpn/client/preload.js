// Мост между окном и главным процессом. Рендерер не имеет доступа к Node
// напрямую (contextIsolation), поэтому наружу торчит только этот белый список.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paulvpn', {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  deploy: (options) => ipcRenderer.invoke('deploy:run', options),
  listPeers: (options) => ipcRenderer.invoke('peers:list', options),
  addPeer: (options) => ipcRenderer.invoke('peers:add', options),
  removePeer: (options) => ipcRenderer.invoke('peers:remove', options),
  tunnelUp: () => ipcRenderer.invoke('tunnel:up'),
  tunnelDown: () => ipcRenderer.invoke('tunnel:down'),
  tunnelStatus: () => ipcRenderer.invoke('tunnel:status'),
  exportConf: (text) => ipcRenderer.invoke('conf:export', text),
  onLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
});
