const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('thingtimeDesktop', {
  getInfo: () => ipcRenderer.invoke('thingtime-desktop:get-info'),
  loadUrl: (url) => ipcRenderer.invoke('thingtime-desktop:load-url', url),
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
