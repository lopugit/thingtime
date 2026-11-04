'use strict';
const { normalizeEndpointUrl } = require('../desktop-settings.cjs');
const { NativePasswordBroker } = require('./broker.cjs');
const { startPasswordControl } = require('./control.cjs');
const { createNativePasswordApproval } = require('./approval.cjs');

function createDesktopPasswordBridge({ app, safeStorage, context: getDesktopContext, dialog, window: getWindow, BrowserWindow, ipcMain, preload }) {
  const context = () => {
    const current = getDesktopContext();
    if (!current?.session) return current;
    // Desktop settings store root URLs; the broker and approval use exact origins.
    let endpoint = null;
    try { endpoint = new URL(normalizeEndpointUrl(current.endpoint)).origin; } catch {}
    return { ...current, endpoint };
  };
  const approval = createNativePasswordApproval({ BrowserWindow, ipcMain, preload, context, window: getWindow });
  const broker = new NativePasswordBroker({ userData: app.getPath('userData'), safeStorage, context, verify: request => approval.approve(request), approve: async ({ taskId, scope, target }) => {
    const options = { type: 'question', title: 'Thingtime Password AutoFill', message: 'Allow this credential task for 15 minutes?',
      detail: `Task: ${taskId}\nVault: ${scope.origin}\nAccount: ${scope.ownerId}\nTarget: ${target.kind === 'website' ? target.origin : 'GNOME login keyring'}\n\nThis scope can create saved passwords and request direct delivery. Each credential use still follows your verification policy. Credential values are never returned to the agent. The browser uses a separate profile with normal networking.`,
      buttons: ['Cancel', 'Allow this scope'], defaultId: 0, cancelId: 0, noLink: true };
    const window = getWindow();
    const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    return result.response === 1;
  } });
  let control, starting, observedSession, observedWindow;
  const invalidate = () => { approval.cancel(); void broker.invalidate().catch(() => {}); };
  const cookiesChanged = (_event, cookie) => { if (cookie?.name === 'tt_auth') invalidate(); };
  const observe = () => {
    const current = context();
    if (observedSession !== current?.session) {
      observedSession?.cookies?.removeListener('changed', cookiesChanged);
      if (observedSession) invalidate();
      observedSession = current?.session; observedSession?.cookies?.on('changed', cookiesChanged);
    }
    const window = getWindow();
    if (window !== observedWindow) {
      observedWindow?.webContents?.removeListener('render-process-gone', invalidate);
      observedWindow?.removeListener('closed', invalidate);
      if (observedWindow) invalidate();
      observedWindow = window;
      observedWindow?.webContents?.on('render-process-gone', invalidate);
      observedWindow?.on('closed', invalidate);
    }
  };
  const start = () => starting ||= startPasswordControl(broker).then(value => control = value).catch(error => { starting = null; throw error; });
  return { broker, start, connection: (action, ownerId) => { observe(); if (action === 'disconnect' || action === 'sync' && !ownerId) approval.cancel(); return broker.connection(action, ownerId); }, invalidate: () => { approval.cancel(); return broker.invalidate(); }, async close() {
    approval.close();
    observedSession?.cookies?.removeListener('changed', cookiesChanged);
    observedWindow?.webContents?.removeListener('render-process-gone', invalidate); observedWindow?.removeListener('closed', invalidate);
    if (starting) await starting.catch(() => {}); if (control) await control.close(); else await broker.close();
  } };
}
module.exports = { createDesktopPasswordBridge };
