'use strict';

// ready-to-show is not guaranteed after every renderer/relaunch path. A healthy
// local backend must not leave a show:false window permanently inaccessible.
function ensureWindowVisible(window, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
 let disposed = false;
 let timer;
 const show = () => {
  if (disposed || window.isDestroyed()) return;
  if (timer) clearTimer(timer);
  window.show();
 };
 const failed = (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame !== false) show(); };
 const cleanup = () => {
  disposed = true;
  if (timer) clearTimer(timer);
  window.removeListener('ready-to-show', show);
  window.webContents.removeListener('did-finish-load', show);
  window.webContents.removeListener('did-fail-load', failed);
  window.webContents.removeListener('render-process-gone', show);
 };
 window.once('ready-to-show', show);
 window.webContents.once('did-finish-load', show);
 window.webContents.on('did-fail-load', failed);
 window.webContents.once('render-process-gone', show);
 window.once('closed', cleanup);
 timer = setTimer(show, 5000);
 timer?.unref?.();
 return cleanup;
}
module.exports = { ensureWindowVisible };
