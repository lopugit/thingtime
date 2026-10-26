'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = async (operation, args = {}) => {
  const result = await ipcRenderer.invoke('acceptance-viewer:command', { operation, args });
  if (!result?.ok) {
    const message = 'The isolated viewer request was refused. Inspect the task connection and current page before retrying.';
    throw new Error(message + ' [' + result?.diagnostic?.operation + '/' + result?.diagnostic?.stage + ':' + result?.diagnostic?.code + ']');
  }
  return result.value;
};
contextBridge.exposeInMainWorld('acceptanceViewer', Object.freeze({
  tabs: () => call('tabs'), frame: () => call('frame'),
  navigate: url => call('navigate', { url }), type: text => call('type', { text }),
  click: (x, y) => call('click', { x, y }), key: key => call('key', { key }),
  scroll: y => call('scroll', { y }), viewport: (width, height) => call('viewport', { width, height })
}));
