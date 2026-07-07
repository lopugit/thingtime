const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const localWebOutput = path.join(__dirname, 'dist', 'web', '.output');

let appOrigin = null;
let mainWindow = null;

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

function isAppUrl(targetUrl) {
  if (!targetUrl || targetUrl === 'about:blank') {
    return true;
  }

  try {
    return new URL(targetUrl).origin === appOrigin;
  } catch {
    return false;
  }
}

function createWindow(startUrl) {
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
    if (isAppUrl(url)) {
      return { action: 'allow' };
    }

    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.loadURL(startUrl);
}

ipcMain.handle('thingtime-desktop:get-info', () => ({
  appVersion: app.getVersion(),
  origin: appOrigin,
  platform: process.platform
}));

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
    .then((origin) => createWindow(origin))
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
