const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const localWebOutput = path.join(__dirname, 'dist', 'web', '.output');
const productionUrl = 'https://thingtime.com/';
const clearElectronUrlParam = 'thingtimeDesktopClearUrl';

let appOrigin = null;
let activeContentOrigin = null;
let mainWindow = null;
let sessionHash = null;

function getSessionHash() {
  if (!sessionHash) {
    const seed = `${app.getName()}|${app.getPath('userData')}`;
    sessionHash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  }

  return sessionHash;
}

function readEnvValue(rawValue) {
  let value = rawValue.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value.replace(/\\n/g, '\n');
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = readEnvValue(trimmed.slice(separator + 1));

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv() {
  if (app.isPackaged) {
    return;
  }

  const remixDir = path.join(repoRoot, 'remix');

  loadEnvFile(path.join(remixDir, '.env'));
  loadEnvFile(path.join(remixDir, '.env.local'));
  loadEnvFile(path.join(remixDir, '.env.auto'));
}

function getWebOutputDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'web', '.output');
  }

  return localWebOutput;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;

      server.close(() => {
        if (!port) {
          reject(new Error('Unable to reserve a local port for Thingtime.'));
          return;
        }

        resolve(port);
      });
    });
  });
}

function waitForHttp(url, attempts = 80) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;

    const tryRequest = () => {
      let finished = false;
      const retryOnce = () => {
        if (finished) {
          return;
        }

        finished = true;
        retry();
      };

      const request = http.get(url, (response) => {
        response.resume();

        if (response.statusCode && response.statusCode < 500) {
          finished = true;
          resolve();
          return;
        }

        retryOnce();
      });

      request.on('error', retryOnce);
      request.setTimeout(1000, () => {
        request.destroy();
        retryOnce();
      });
    };

    const retry = () => {
      remaining -= 1;

      if (remaining <= 0) {
        reject(new Error(`Thingtime did not start at ${url}`));
        return;
      }

      setTimeout(tryRequest, 250);
    };

    tryRequest();
  });
}

async function startNitroServer() {
  const outputDir = getWebOutputDir();
  const serverEntry = path.join(outputDir, 'server', 'index.mjs');

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Missing bundled web server at ${serverEntry}. Run "pnpm --dir electron build:web" before starting Electron.`
    );
  }

  loadLocalEnv();

  const port = await getFreePort();

  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.HOST = '127.0.0.1';
  process.env.NITRO_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.NITRO_PORT = String(port);
  process.env.THINGTIME_DESKTOP = '1';

  await import(pathToFileURL(serverEntry).href);

  const origin = `http://127.0.0.1:${port}`;

  await waitForHttp(`${origin}/`);

  appOrigin = origin;

  return origin;
}

function normalizeDesktopUrl(rawUrl) {
  const value = String(rawUrl || '').trim();

  if (!value) {
    throw new Error('Enter a URL to load in Thingtime desktop.');
  }

  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid URL, including http:// or https://.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Thingtime desktop can only load http:// or https:// URLs.');
  }

  return url.href;
}

function isAllowedContentUrl(targetUrl) {
  if (!targetUrl || targetUrl === 'about:blank') {
    return true;
  }

  try {
    const origin = new URL(targetUrl).origin;
    return origin === appOrigin || origin === activeContentOrigin;
  } catch {
    return false;
  }
}

function getDesktopInfo() {
  return {
    appVersion: app.getVersion(),
    contentOrigin: activeContentOrigin || appOrigin,
    currentUrl: mainWindow?.webContents.getURL() || appOrigin,
    isPackaged: app.isPackaged,
    origin: appOrigin,
    platform: process.platform,
    sessionHash: getSessionHash()
  };
}

async function loadDesktopUrl(rawUrl) {
  if (!mainWindow) {
    throw new Error('Thingtime desktop window is not ready yet.');
  }

  const targetUrl = normalizeDesktopUrl(rawUrl);
  activeContentOrigin = new URL(targetUrl).origin;
  await mainWindow.loadURL(targetUrl);

  return getDesktopInfo();
}

function showLoadUrlError(error) {
  dialog.showErrorBox('Thingtime URL failed', error instanceof Error ? error.message : String(error));
}

function loadMenuUrl(url) {
  loadDesktopUrl(url).catch(showLoadUrlError);
}

function withClearSavedUrlParam(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set(clearElectronUrlParam, '1');
  return url.href;
}

function createApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
          }
        ]
      : []),
    {
      label: 'Thingtime',
      submenu: [
        {
          label: 'Load Bundled App',
          accelerator: 'CommandOrControl+Alt+L',
          click: () => {
            if (appOrigin) {
              loadMenuUrl(withClearSavedUrlParam(appOrigin));
            }
          }
        },
        {
          label: 'Load Production',
          accelerator: 'CommandOrControl+Alt+P',
          click: () => loadMenuUrl(productionUrl)
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(startUrl) {
  activeContentOrigin = new URL(startUrl).origin;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: 'Thingtime',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedContentUrl(url)) {
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedContentUrl(url)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.loadURL(startUrl);
}

ipcMain.handle('thingtime-desktop:get-info', () => getDesktopInfo());
ipcMain.handle('thingtime-desktop:load-url', (_event, url) => loadDesktopUrl(url));

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady()
    .then(startNitroServer)
    .then((origin) => {
      createWindow(origin);
      createApplicationMenu();
    })
    .catch((error) => {
      dialog.showErrorBox('Thingtime failed to start', error instanceof Error ? error.message : String(error));
      app.quit();
    });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && appOrigin) {
    createWindow(appOrigin);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
