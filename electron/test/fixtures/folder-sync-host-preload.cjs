const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('folderFixture', { request: input => ipcRenderer.invoke('fixture:folder-sync', input) });
