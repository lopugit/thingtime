'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { exactOrigin, targetScope, UUID, fail, PasswordBridgeError } = require('./contract.cjs');

const READY = 'thingtime-desktop:password-approval-ready';
const RESPOND = 'thingtime-desktop:password-approval-respond';
const ROUTE = '/passwords/provider?view=vault';
const MARKER = '--thingtime-native-password-approval';
const BINDING = /^[A-Za-z0-9_-]{43}$/;

function createNativePasswordApproval({ BrowserWindow, ipcMain, preload, context, window: getWindow, timeout = 90000, platform = process.platform }) {
  let pending, closed = false;

  function finish(operation, error, proof) {
    if (pending !== operation) return;
    pending = null;
    clearTimeout(operation.timer);
    if (!operation.window.isDestroyed()) operation.window.destroy();
    if (error) operation.reject(error);
    else operation.resolve(proof);
  }
  function cancel(operation = pending) {
    if (!operation || operation !== pending) return;
    finish(operation, new PasswordBridgeError('APPROVAL_CANCELLED', 'The credential approval ended. Start a new request.'));
  }
  function requireSender(event, ownerId) {
    const operation = pending;
    const frame = event.senderFrame;
    if (!operation || operation.window.isDestroyed() || event.sender !== operation.window.webContents || !frame || frame !== event.sender.mainFrame || frame.url !== operation.url || ownerId !== operation.request.expectedOwnerId) fail('INVALID_APPROVAL', 'The credential approval window or account changed.');
    const current = context();
    if (operation.parent !== getWindow() || current?.session !== operation.session || current?.origin !== operation.origin || current?.endpoint !== operation.request.apiOrigin) {
      cancel(operation);
      fail('SESSION_CHANGED', 'The active Thingtime account or endpoint changed.');
    }
    try { operation.assertCurrent(); }
    catch (error) { finish(operation, error); throw error; }
    return { operation, frame };
  }

  ipcMain.handle(READY, (event, ownerId) => {
    const { operation, frame } = requireSender(event, ownerId);
    operation.frame = frame;
    return operation.request;
  });
  ipcMain.handle(RESPOND, (event, response) => {
    const { operation, frame } = requireSender(event, response?.ownerId);
    if (operation.frame !== frame || response.id !== operation.request.id) fail('INVALID_APPROVAL', 'The credential approval request changed.');
    if (response.cancelled === true && Object.keys(response).length === 3) { cancel(operation); return; }
    const proof = response.proof, expected = operation.verificationContext;
    const matches = expected ? proof?.context && Object.keys(proof.context).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) => proof.context[key] === value) : proof?.context === undefined;
    if (Object.keys(response).length !== 3 || proof?.requestId !== operation.request.id || typeof proof.binding !== 'string' || !BINDING.test(proof.binding) || !matches || Object.keys(proof).length !== (expected ? 3 : 2)) fail('INVALID_APPROVAL', 'The credential verification proof did not match this request.');
    finish(operation, null, { requestId: proof.requestId, binding: proof.binding, ...(expected ? { context: expected } : {}) });
  });

  async function approve({ scope, target, entryId, assertCurrent }) {
    if (closed || pending) fail('APPROVAL_BUSY', 'Finish the current credential approval before starting another.');
    const current = context(), parent = getWindow();
    const origin = exactOrigin(current?.origin), apiOrigin = exactOrigin(scope.origin);
    if (!parent || parent.isDestroyed() || !current?.session || parent.webContents.session !== current.session || current.endpoint !== apiOrigin || !scope.ownerId || typeof entryId !== 'string' || !UUID.test(entryId)) fail('SESSION_CHANGED', 'Open Thingtime on the intended vault account before approving credentials.');
    assertCurrent();
    const destination = targetScope(target, platform);
    if (destination.kind === 'website' && !destination.origin.startsWith('https://')) fail('UNSUPPORTED_TARGET', 'Protected browser autofill requires an HTTPS website.');
    const id = randomUUID();
    const requestHash = createHash('sha256').update(JSON.stringify([id, apiOrigin, scope.ownerId, destination, entryId])).digest('base64url');
    const verificationContext = destination.kind === 'website' ? { purpose: 'fill', rp: new URL(destination.origin).hostname, entryId, origin: destination.origin, requestHash } : undefined;
    const request = { version: 1, id, expectedOwnerId: scope.ownerId, apiOrigin, entryId, requestHash,
      ...(verificationContext ? { type: 'fill', origin: destination.origin } : { type: 'native-consumer', consumerId: destination.id }) };
    const url = `${origin}${ROUTE}`;
    const window = new BrowserWindow({ parent, modal: true, width: 620, height: 650, show: false, title: 'Thingtime Password Approval',
      webPreferences: { session: current.session, preload, additionalArguments: [MARKER], sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false } });
    return new Promise((resolve, reject) => {
      const operation = { request, verificationContext, window, parent, url, origin, session: current.session, assertCurrent, resolve, reject, frame: null };
      pending = operation;
      operation.timer = setTimeout(() => cancel(operation), timeout);
      window.once('closed', () => cancel(operation));
      window.once('ready-to-show', () => { if (pending === operation) window.show(); });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const blockNavigation = event => { event.preventDefault(); cancel(operation); };
      window.webContents.on('will-navigate', blockNavigation);
      window.webContents.on('will-redirect', blockNavigation);
      window.webContents.on('did-start-navigation', details => {
        if (!details.isMainFrame) return;
        // React Router seeds history state at the same URL without replacing the document.
        if (details.url !== url || (operation.started && details.isSameDocument !== true)) return cancel(operation);
        operation.started = true;
      });
      window.webContents.on('render-process-gone', () => cancel(operation));
      window.loadURL(url).catch(() => cancel(operation));
    });
  }

  return { approve, cancel: () => cancel(), close() {
    closed = true;
    cancel();
    ipcMain.removeHandler(READY);
    ipcMain.removeHandler(RESPOND);
  } };
}

module.exports = { createNativePasswordApproval };
