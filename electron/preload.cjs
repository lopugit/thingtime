const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('thingtimeDesktop', {
  getInfo: () => ipcRenderer.invoke('thingtime-desktop:get-info'),
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});
