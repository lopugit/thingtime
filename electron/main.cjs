const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');

const repoRoot = path.resolve(__dirname, '..');
const localWebOutput = path.join(__dirname, 'dist', 'web', '.output');
const productionUrl = 'https://thingtime.com/';
const clearElectronUrlParam = 'thingtimeDesktopClearUrl';
const electronReleaseLabel = process.env.THINGTIME_DESKTOP_RELEASE_LABEL || 'Electron App Release';
const updateFeedUrl =
  process.env.THINGTIME_DESKTOP_UPDATE_FEED_URL ||
  'https://api.github.com/repos/lopugit/thingtime/releases?per_page=20';

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

function normalizeVersionString(version) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/)[0]
    .trim();
}

function compareVersions(leftVersion, rightVersion) {
  const leftParts = normalizeVersionString(leftVersion).split('.');
  const rightParts = normalizeVersionString(rightVersion).split('.');
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftRaw = leftParts[index] || '0';
    const rightRaw = rightParts[index] || '0';
    const leftNumber = Number.parseInt(leftRaw, 10);
    const rightNumber = Number.parseInt(rightRaw, 10);

    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      if (leftNumber > rightNumber) {
        return 1;
      }

      if (leftNumber < rightNumber) {
        return -1;
      }

      continue;
    }

    const lexical = leftRaw.localeCompare(rightRaw, undefined, { numeric: true, sensitivity: 'base' });

    if (lexical !== 0) {
      return lexical > 0 ? 1 : -1;
    }
  }

  return 0;
}

function requestJson(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Thingtime/${app.getVersion()}`
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 5) {
          response.resume();
          resolve(requestJson(new URL(location, url).href, redirectCount + 1));
          return;
        }

        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;

          if (body.length > 1024 * 1024) {
            request.destroy(new Error('Update response was too large.'));
          }
        });
        response.on('end', () => {
          if (statusCode === 404) {
            resolve(null);
            return;
          }

          if (statusCode >= 400) {
            reject(new Error(`Update feed returned HTTP ${statusCode}.`));
            return;
          }

          try {
            resolve(JSON.parse(body || 'null'));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.setTimeout(10000, () => {
      request.destroy(new Error('Update check timed out.'));
    });
    request.on('error', reject);
  });
}

function releaseMatchesElectronLabel(release) {
  const needle = electronReleaseLabel.toLowerCase();
  const haystack = `${release?.name || ''} ${release?.tag_name || ''} ${release?.body || ''}`.toLowerCase();
  return haystack.includes(needle);
}

function scoreReleaseAsset(asset) {
  const name = String(asset?.name || '');
  const label = String(asset?.label || '');
  const contentType = String(asset?.content_type || '');
  const haystack = `${name} ${label} ${contentType}`.toLowerCase();
  let score = 0;

  if (!asset?.browser_download_url) {
    return 0;
  }

  if (haystack.includes(electronReleaseLabel.toLowerCase())) {
    score += 120;
  }

  if (haystack.includes('electron')) {
    score += 80;
  }

  if (haystack.includes('thingtime')) {
    score += 40;
  }

  if (haystack.includes('mac') || haystack.includes('darwin') || haystack.includes('arm64') || haystack.includes('universal')) {
    score += 25;
  }

  if (/\.(dmg)$/i.test(name)) {
    score += 35;
  } else if (/\.(zip)$/i.test(name)) {
    score += 30;
  } else if (/\.(pkg)$/i.test(name)) {
    score += 25;
  }

  if (/\.(blockmap|ya?ml|sha\d*|sig|txt)$/i.test(name)) {
    score -= 100;
  }

  return Math.max(0, score);
}

function selectElectronAsset(assets) {
  const scoredAssets = (Array.isArray(assets) ? assets : [])
    .map((asset) => ({ asset, score: scoreReleaseAsset(asset) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  const selected = scoredAssets[0]?.asset;

  if (!selected) {
    return null;
  }

  return {
    contentType: selected.content_type || null,
    downloadUrl: selected.browser_download_url,
    label: selected.label || null,
    name: selected.name || null,
    size: typeof selected.size === 'number' ? selected.size : null
  };
}

function selectElectronRelease(rawReleases) {
  const releases = (Array.isArray(rawReleases) ? rawReleases : rawReleases ? [rawReleases] : []).filter(
    (release) => release && !release.draft
  );

  if (releases.length === 0) {
    return { asset: null, release: null };
  }

  const scoredReleases = releases
    .map((release, index) => {
      const asset = selectElectronAsset(release.assets);
      const assetScore = (Array.isArray(release.assets) ? release.assets : []).reduce(
        (highestScore, candidate) => Math.max(highestScore, scoreReleaseAsset(candidate)),
        0
      );
      const score = (releaseMatchesElectronLabel(release) ? 200 : 0) + assetScore - index;
      return { asset, release, score };
    })
    .filter((entry) => entry.score > -1000)
    .sort((left, right) => right.score - left.score);

  return scoredReleases[0] || { asset: null, release: releases[0] };
}

async function resolveUpdateRelease() {
  const releases = await requestJson(updateFeedUrl);
  const { asset, release } = selectElectronRelease(releases);
  const currentVersion = app.getVersion();
  const latestVersion = normalizeVersionString(release?.tag_name || release?.name);
  const updateAvailable = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  if (!release) {
    return {
      asset: null,
      checkedAt: new Date().toISOString(),
      currentVersion,
      feedUrl: updateFeedUrl,
      latestVersion: null,
      message: `No GitHub release named or containing "${electronReleaseLabel}" was found yet.`,
      releaseName: null,
      releaseUrl: null,
      status: 'unavailable',
      updateAvailable: false
    };
  }

  return {
    asset,
    checkedAt: new Date().toISOString(),
    currentVersion,
    feedUrl: updateFeedUrl,
    latestVersion: latestVersion || null,
    message: asset
      ? updateAvailable
        ? `Thingtime ${latestVersion} is available.`
        : `Thingtime ${currentVersion} is up to date.`
      : `No downloadable Electron app bundle asset was found on ${release.name || release.tag_name}.`,
    releaseName: release.name || release.tag_name || null,
    releaseUrl: release.html_url || null,
    status: asset ? (updateAvailable ? 'available' : 'up-to-date') : 'unavailable',
    updateAvailable
  };
}

async function checkForUpdates() {
  try {
    return await resolveUpdateRelease();
  } catch (error) {
    return {
      asset: null,
      checkedAt: new Date().toISOString(),
      currentVersion: app.getVersion(),
      feedUrl: updateFeedUrl,
      latestVersion: null,
      message: error instanceof Error ? error.message : String(error),
      releaseName: null,
      releaseUrl: null,
      status: 'error',
      updateAvailable: false
    };
  }
}

function safeFileName(fileName) {
  const cleaned = String(fileName || '')
    .replace(/[^\w.\-+() ]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'Thingtime-Electron-App-Release.dmg';
}

function uniqueDownloadPath(directory, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directory, fileName);
  let counter = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

function downloadFile(url, targetPath, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(targetPath, { flags: 'wx' });
    let settled = false;

    const cleanup = (error) => {
      if (settled) {
        return;
      }

      settled = true;
      file.destroy();
      fs.rm(targetPath, { force: true }, () => {
        reject(error);
      });
    };

    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': `Thingtime/${app.getVersion()}`
        }
      },
      (response) => {
        const statusCode = response.statusCode || 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 5) {
          response.resume();
          file.close(() => {
            fs.rm(targetPath, { force: true }, (error) => {
              if (error) {
                reject(error);
                return;
              }

              downloadFile(new URL(location, url).href, targetPath, redirectCount + 1).then(resolve, reject);
            });
          });
          return;
        }

        if (statusCode >= 400) {
          response.resume();
          cleanup(new Error(`Update download returned HTTP ${statusCode}.`));
          return;
        }

        response.pipe(file);
        response.on('error', cleanup);
        file.on('finish', () => {
          file.close((error) => {
            if (error) {
              cleanup(error);
              return;
            }

            if (!settled) {
              settled = true;
              resolve();
            }
          });
        });
      }
    );

    file.on('error', cleanup);
    request.setTimeout(120000, () => {
      request.destroy(new Error('Update download timed out.'));
    });
    request.on('error', cleanup);
  });
}

async function downloadUpdateBundle() {
  const updateInfo = await resolveUpdateRelease();

  if (!updateInfo.asset?.downloadUrl) {
    throw new Error(updateInfo.message || 'No downloadable Electron app bundle is available.');
  }

  const downloadsDir = app.getPath('downloads');
  const assetName = safeFileName(updateInfo.asset.name || `Thingtime-${updateInfo.latestVersion || 'latest'}.dmg`);
  const downloadPath = uniqueDownloadPath(downloadsDir, assetName);

  await downloadFile(updateInfo.asset.downloadUrl, downloadPath);
  shell.showItemInFolder(downloadPath);

  return {
    ...updateInfo,
    downloadedAt: new Date().toISOString(),
    downloadPath,
    message: `Downloaded ${assetName} to Downloads.`
  };
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
    sessionHash: getSessionHash(),
    updateFeedUrl
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
ipcMain.handle('thingtime-desktop:check-for-updates', () => checkForUpdates());
ipcMain.handle('thingtime-desktop:download-update-bundle', () => downloadUpdateBundle());

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
