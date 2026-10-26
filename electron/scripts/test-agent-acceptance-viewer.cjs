'use strict';
// Opt-in test GUI only. Never imported by the installed desktop application.
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { ORIGIN, CHANNEL, FAILURE, loadBinding, createBridge, assertSender, diagnostic } = require('./acceptance-viewer-boundary.cjs');

async function main() {
  const { app, BrowserWindow, ipcMain, session } = require('electron');
  const root = process.argv[2];
  if (process.argv.length !== 3) throw new Error(FAILURE);
  const binding = await loadBinding(root);
  const userData = await fs.mkdtemp(path.join(root, 'viewer-'));
  await fs.chmod(userData, 0o700);
  app.setName('Thingtime Isolated Acceptance Viewer');
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);
  app.setPath('crashDumps', userData);
  let window;
  app.on('window-all-closed', () => app.quit());
  process.once('SIGTERM', () => app.quit());
  process.once('SIGINT', () => app.quit());
  await app.whenReady();
  const viewerSession = session.fromPartition(`acceptance-${randomUUID()}`, { cache: false });
  viewerSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  viewerSession.setPermissionCheckHandler(() => false);
  viewerSession.on('will-download', event => event.preventDefault());
  const rendererDir = path.join(__dirname, 'acceptance-viewer');
  const rendererURL = pathToFileURL(path.join(rendererDir, 'index.html')).href;
  const localResources = new Set(['index.html', 'viewer.js', 'viewer.css'].map(file => pathToFileURL(path.join(rendererDir, file)).href));
  viewerSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !localResources.has(details.url) && !(details.resourceType === 'image' && /^data:image\/jpeg;base64,/.test(details.url)) }));
  window = new BrowserWindow({ width: 1320, height: 1000, minWidth: 420, minHeight: 600,
    title: 'Thingtime isolated acceptance — ' + ORIGIN,
    webPreferences: { preload: path.join(rendererDir, 'preload.cjs'), session: viewerSession,
      nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false,
      spellcheck: false, navigateOnDragDrop: false } });
  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  const command = createBridge(binding);
  ipcMain.handle(CHANNEL, async (event, input) => {
    try { assertSender(event, contents, rendererURL); return { ok: true, value: await command(input) }; }
    catch (error) { return { ok: false, error: FAILURE, diagnostic: diagnostic(error) }; }
  });
  let cleaning = false, cleaned = false;
  app.on('before-quit', event => {
    if (cleaned) return;
    event.preventDefault();
    if (cleaning) return;
    cleaning = true;
    ipcMain.removeHandler(CHANNEL);
    window?.destroy();
    viewerSession.clearStorageData().then(() => fs.rm(userData, { recursive: true, force: true }))
      .finally(() => { cleaned = true; app.quit(); }).catch(() => {});
  });
  await window.loadURL(rendererURL);
  // No automatic lease release: the installed app may still need this backend.
  await new Promise(resolve => app.once('will-quit', resolve));
}
// Electron's CommonJS launcher owns require.main; identify its explicit script
// argument as well, while keeping ordinary imports side-effect free.
function isEntrypoint(entry = process.argv[1]) {
  return typeof entry === 'string' && path.resolve(entry) === __filename;
}
if (require.main === module || isEntrypoint()) main().catch(() => { process.stderr.write(FAILURE + '\n'); process.exitCode = 1; try { require('electron').app.quit(); } catch {} });
module.exports = { main, isEntrypoint };
