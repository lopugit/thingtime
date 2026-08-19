const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const {
	ThingtimeNodeBridgeError,
	ThingtimeNodeIntegration,
	ensureLocalProjectRegistry,
	normalizePermissions,
	registerLocalProject,
	validateDeviceRequest
} = require('./lib/thingtime-node-bridge.cjs');

const repoRoot = path.resolve(__dirname, '..');
const localWebOutput = path.join(__dirname, 'dist', 'web', '.output');
const productionUrl = 'https://thingtime.com/';
const clearElectronUrlParam = 'thingtimeDesktopClearUrl';
const electronReleaseLabel = process.env.THINGTIME_DESKTOP_RELEASE_LABEL || 'Electron App Release';
const updateFeedUrl = process.env.THINGTIME_DESKTOP_UPDATE_FEED_URL || 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=20';
const macTitlebar = {
  height: 52,
  leftInset: 88,
  navStart: 132,
  trafficLightPosition: { x: 14, y: 17 }
};

let appOrigin = null;
let activeContentOrigin = null;
let webBuildMetadata = null;
let mainWindow = null;
let sessionHash = null;
let aiConnectorsPromise = null;
const aiSyncSessions = new Map();
const thingtimeNode = new ThingtimeNodeIntegration({ app, electronDir: __dirname });

function getSessionHash() {
  if (!sessionHash) {
    const seed = `${app.getName()}|${app.getPath('userData')}`;
    sessionHash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 12);
  }

  return sessionHash;
}

function readEnvValue(rawValue) {
  let value = rawValue.trim();

	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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

function readWebBuildMetadata() {
  if (webBuildMetadata) {
    return webBuildMetadata;
  }

  const metadataPath = path.join(path.dirname(getWebOutputDir()), 'metadata.json');

  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    webBuildMetadata = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    webBuildMetadata = {};
  }

  return webBuildMetadata;
}

function getCurrentAppVersion() {
  const releaseVersion = readWebBuildMetadata()?.desktopRelease?.version;
  return normalizeVersionString(releaseVersion) || app.getVersion();
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
		throw new Error(`Missing bundled web server at ${serverEntry}. Run "pnpm --dir electron build:web" before starting Electron.`);
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
  const value = String(version || '').trim();
  const match = value.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);

  return (match ? match[1] : value.replace(/^v/i, '')).trim();
}

function parseVersionInfo(version) {
  const normalized = normalizeVersionString(version);
  const [withoutBuildMetadata, buildMetadata = ''] = normalized.split('+');
  const core = withoutBuildMetadata.split('-')[0];
  const coreParts = core.split('.').map((part) => {
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const buildMatch = buildMetadata.match(/(?:^|[.-])build[.-]?(\d+)|(\d+)/i);
  const buildNumber = buildMatch ? Number.parseInt(buildMatch[1] || buildMatch[2], 10) : 0;

  return {
    buildNumber: Number.isFinite(buildNumber) ? buildNumber : 0,
    coreParts,
    version: normalized
  };
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersionInfo(leftVersion);
  const right = parseVersionInfo(rightVersion);
  const length = Math.max(left.coreParts.length, right.coreParts.length, 3);

  for (let index = 0; index < length; index += 1) {
    const leftNumber = left.coreParts[index] || 0;
    const rightNumber = right.coreParts[index] || 0;

    if (leftNumber > rightNumber) {
      return 1;
    }

    if (leftNumber < rightNumber) {
      return -1;
    }
  }

  if (left.buildNumber > right.buildNumber) {
    return 1;
  }

  if (left.buildNumber < right.buildNumber) {
    return -1;
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
          'User-Agent': `Thingtime/${getCurrentAppVersion()}`
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
	const releases = (Array.isArray(rawReleases) ? rawReleases : rawReleases ? [rawReleases] : []).filter((release) => release && !release.draft);

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
  const currentVersion = getCurrentAppVersion();
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
      currentVersion: getCurrentAppVersion(),
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
          'User-Agent': `Thingtime/${getCurrentAppVersion()}`
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

function trustedAiBridgeOrigins() {
  const configured = String(process.env.THINGTIME_DESKTOP_AI_TRUSTED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return new Set([appOrigin, 'https://thingtime.com', 'https://www.thingtime.com', 'https://dev.thingtime.com', ...configured].filter(Boolean));
}

function requireTrustedAiBridgeEvent(event) {
  const frameUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  let origin = '';
  try {
    origin = new URL(frameUrl).origin;
  } catch {
    throw new Error('AI desktop access requires a trusted Thingtime page.');
  }
  if (!trustedAiBridgeOrigins().has(origin)) {
    throw new Error('This page is not allowed to read AI desktop sources.');
  }
}

function requireMacNode(event) {
	requireTrustedAiBridgeEvent(event);
	if (process.platform !== 'darwin') {
		throw new ThingtimeNodeBridgeError('unsupported_platform', 'Thingtime Node is currently available on macOS only.');
	}
}

async function confirmNodeChange({ title, message, detail, confirmLabel }) {
	const result = await dialog.showMessageBox(mainWindow || undefined, {
		type: 'question',
		title,
		message,
		detail,
		buttons: [confirmLabel, 'Cancel'],
		defaultId: 1,
		cancelId: 1,
		noLink: true
	});
	return result.response === 0;
}

async function nodeGetStatus(event) {
	requireMacNode(event);
	return thingtimeNode.status();
}

function nodeProjectRegistryPath() {
	return path.join(app.getPath('userData'), 'thingtime-node', 'projects.json');
}

async function nodeRegisterService(event) {
	requireMacNode(event);
	const confirmed = await confirmNodeChange({
		title: 'Start Thingtime Node at login?',
		message: 'Allow Thingtime to run its local node while you are signed in?',
		detail:
			'The node keeps device state and approved desktop-chat connectors available even when the Thingtime window is closed. You can turn it off again from Thingtime.',
		confirmLabel: 'Enable Node'
	});
	if (!confirmed) return thingtimeNode.status();
	const projectRegistryPath = nodeProjectRegistryPath();
	await ensureLocalProjectRegistry(projectRegistryPath);
	return thingtimeNode.registerService({ projectRegistryPath });
}

async function nodeAddProject(event) {
	requireMacNode(event);
	const registration = await thingtimeNode.registrationStatus();
	if (!registration.registered) {
		throw new ThingtimeNodeBridgeError('node_not_registered', 'Start Thingtime Node before adding a local Codex project.');
	}
	const selection = await dialog.showOpenDialog(mainWindow || undefined, {
		title: 'Add a local Codex project to Thingtime Node',
		buttonLabel: 'Add Project',
		properties: ['openDirectory', 'createDirectory']
	});
	if (selection.canceled || selection.filePaths.length !== 1) return { cancelled: true };
	const projectRegistryPath = nodeProjectRegistryPath();
	const project = await registerLocalProject(projectRegistryPath, selection.filePaths[0]);
	const status = await thingtimeNode.registerService({ projectRegistryPath });
	return { cancelled: false, project, status };
}

async function nodeUnregisterService(event) {
	requireMacNode(event);
	const confirmed = await confirmNodeChange({
		title: 'Stop Thingtime Node?',
		message: 'Turn off the Thingtime login node on this Mac?',
		detail: 'Remote device state and desktop-chat connectors will be unavailable after the node stops.',
		confirmLabel: 'Turn Off Node'
	});
	return confirmed ? thingtimeNode.unregisterService() : thingtimeNode.status();
}

async function nodeBeginPairing(event) {
	requireMacNode(event);
	const challenge = await thingtimeNode.request('pairing.begin');
	return {
		code: challenge?.pairingID || null,
		expiresAt: challenge?.expiresAt || null,
		nonce: challenge?.nonce || null,
		publicKey: challenge?.publicKey || null,
		status: 'pairing'
	};
}

async function nodeCompletePairing(event, request) {
	requireMacNode(event);
	const pairingSecret = typeof request?.pairingSecret === 'string' ? request.pairingSecret : '';
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!pairingSecret || !commandId) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Pairing requires a secret and commandId.');
	}
	const confirmed = await confirmNodeChange({
		title: 'Pair this Mac with Thingtime?',
		message: 'Connect this Mac to your Thingtime account?',
		detail: 'Thingtime Node will store a device credential in your macOS Keychain and begin syncing approved device state.',
		confirmLabel: 'Pair Mac'
	});
	if (!confirmed) return thingtimeNode.status();
	await thingtimeNode.request('pairing.claim', { pairingSecret }, commandId);
	return thingtimeNode.status();
}

async function nodeResumePairing(event, request) {
	requireMacNode(event);
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!commandId) throw new ThingtimeNodeBridgeError('invalid_request', 'Resuming pairing requires a commandId.');
	const confirmed = await confirmNodeChange({
		title: 'Resume pairing this Mac?',
		message: 'Finish connecting this Mac to your Thingtime account?',
		detail: 'Thingtime Node will retry only the exact pending signed pairing claim stored in your macOS Keychain.',
		confirmLabel: 'Resume Pairing'
	});
	if (!confirmed) return thingtimeNode.status();
	await thingtimeNode.request('pairing.resume', {}, commandId);
	return thingtimeNode.status();
}

async function nodeUnpair(event, request) {
	requireMacNode(event);
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!commandId) throw new ThingtimeNodeBridgeError('invalid_request', 'Unpairing requires a commandId.');
	const confirmed = await confirmNodeChange({
		title: 'Unpair this Mac?',
		message: 'Remove this Mac from Thingtime Node?',
		detail: 'The local device credential will be removed from the macOS Keychain. The login node remains installed until you turn it off separately.',
		confirmLabel: 'Unpair Mac'
	});
	if (!confirmed) return thingtimeNode.status();
	await thingtimeNode.request('pairing.unpair', {}, commandId);
	return thingtimeNode.status();
}

async function nodeGetPermissions(event) {
	requireMacNode(event);
	return normalizePermissions(await thingtimeNode.request('permissions.preflight'));
}

const NODE_PERMISSION_SETTINGS = Object.freeze({
	accessibility: {
		label: 'Accessibility',
		url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
	},
	'screen-recording': {
		label: 'Screen Recording',
		url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
	}
});

async function nodeOpenPermissionSettings(event, request) {
	requireMacNode(event);
	const kind = typeof request?.kind === 'string' && Object.hasOwn(NODE_PERMISSION_SETTINGS, request.kind) ? request.kind : null;
	const permission = kind ? NODE_PERMISSION_SETTINGS[kind] : null;
	if (!permission) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Choose a supported Thingtime Node permission.');
	}
	const paths = thingtimeNode.paths();
	await thingtimeNode.verify(paths);
	const confirmed = await confirmNodeChange({
		title: `Open ${permission.label} settings?`,
		message: `Allow Thingtime Node in macOS ${permission.label}?`,
		detail:
			'In Privacy & Security, add or enable the signed “Thingtime Node” helper. Finder will also reveal the exact helper bundled with this Thingtime app.',
		confirmLabel: 'Open Settings'
	});
	if (!confirmed) return { kind, opened: false };
	shell.showItemInFolder(paths.helperApp);
	await shell.openExternal(permission.url);
	return { kind, opened: true };
}

async function nodeConnectorCommand(event, request) {
	requireMacNode(event);
	return thingtimeNode.connector(request);
}

function describeDeviceAction(request) {
	switch (request.request.kind) {
		case 'system.volume.set': {
			const volume = request.request.parameters.volume;
			const label = typeof volume === 'number' && Number.isFinite(volume) ? `${Math.round(volume * 100)}%` : 'the requested level';
			return { message: `Set this Mac's output volume to ${label}?`, confirmLabel: 'Set Volume' };
		}
		case 'application.activate':
			return { message: 'Bring the requested application to the front?', confirmLabel: 'Activate App' };
		case 'application.launch':
			return { message: 'Launch the requested application on this Mac?', confirmLabel: 'Launch App' };
		default:
			return { message: 'Run this approved device action?', confirmLabel: 'Run Action' };
	}
}

async function nodeDeviceCommand(event, value) {
	requireMacNode(event);
	const request = validateDeviceRequest(value);
	if (request.action !== 'execute' || request.request.kind === 'telemetry.refresh') {
		return thingtimeNode.device(request);
	}
	const description = describeDeviceAction(request);
	const confirmed = await confirmNodeChange({
		title: 'Approve Thingtime device action',
		message: description.message,
		detail: 'Thingtime Node will also refuse this action if the Mac user session is locked.',
		confirmLabel: description.confirmLabel
	});
	if (!confirmed) {
		throw new ThingtimeNodeBridgeError('approval_required', 'The device action was not approved.');
	}
	return thingtimeNode.device(request, { userApproved: true });
}

function aiConnectorPath() {
	return app.isPackaged ? path.join(process.resourcesPath, 'ai', 'ai-connectors.mjs') : path.join(__dirname, 'dist', 'ai', 'ai-connectors.mjs');
}

function loadAiConnectors() {
  if (!aiConnectorsPromise) aiConnectorsPromise = import(pathToFileURL(aiConnectorPath()).href);
  return aiConnectorsPromise;
}

function aiSyncSession(request) {
  const syncId = typeof request?.syncId === 'string' ? request.syncId : '';
  const session = syncId ? aiSyncSessions.get(syncId) : null;
  if (!session) throw new Error('That AI sync session expired. Start it again.');
  if (Date.now() - session.touchedAt > 30 * 60 * 1000) {
    aiSyncSessions.delete(syncId);
    throw new Error('That AI sync session expired. Start it again.');
  }
  session.touchedAt = Date.now();
  return { syncId, session };
}

async function discoverAiSources(event) {
  requireTrustedAiBridgeEvent(event);
  const connectors = await loadAiConnectors();
  return connectors.discoverDesktopSources();
}

async function beginAiSync(event, request) {
  requireTrustedAiBridgeEvent(event);
  const sourceId = ['chatgpt', 'claude', 'claude-thingtime'].includes(request?.sourceId) ? request.sourceId : null;
  const mode = request?.mode === 'local' || request?.mode === 'export' ? request.mode : null;
  if (!sourceId || !mode) throw new Error('Choose a valid AI desktop source and sync mode.');
  let archivePath = null;
  if (mode === 'export') {
    const selection = await dialog.showOpenDialog(mainWindow || undefined, {
      title: `Choose the official ${sourceId === 'chatgpt' ? 'ChatGPT' : 'Claude'} export`,
      properties: ['openFile'],
      filters: [
        { name: 'Provider export', extensions: ['zip', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
    archivePath = selection.filePaths[0];
  }
  const connectors = await loadAiConnectors();
  const prepared = await connectors.prepareDesktopSync({ sourceId, mode, archivePath });
  const syncId = crypto.randomUUID();
  aiSyncSessions.set(syncId, { prepared, cursor: 0, touchedAt: Date.now() });
  while (aiSyncSessions.size > 4) aiSyncSessions.delete(aiSyncSessions.keys().next().value);
  return { syncId, totals: prepared.totals };
}

async function readAiSyncBatch(event, request) {
  requireTrustedAiBridgeEvent(event);
  const { syncId, session } = aiSyncSession(request);
  const connectors = await loadAiConnectors();
  const batch = connectors.nextDesktopSyncBatch(session.prepared, session.cursor);
  session.cursor = batch.nextCursor;
  const { nextCursor: _nextCursor, ...publicBatch } = batch;
  return { syncId, ...publicBatch };
}

async function cancelAiSync(event, request) {
  requireTrustedAiBridgeEvent(event);
  const syncId = typeof request?.syncId === 'string' ? request.syncId : '';
  if (syncId) aiSyncSessions.delete(syncId);
  return { ok: true };
}

function getDesktopInfo() {
  return {
    appVersion: getCurrentAppVersion(),
    contentOrigin: activeContentOrigin || appOrigin,
    currentUrl: mainWindow?.webContents.getURL() || appOrigin,
    isPackaged: app.isPackaged,
    origin: appOrigin,
    platform: process.platform,
    sessionHash: getSessionHash(),
    titlebar:
      process.platform === 'darwin'
        ? {
            enabled: true,
            style: 'hidden',
            ...macTitlebar
          }
        : {
            enabled: false,
            height: 0,
            leftInset: 0,
            navStart: 34,
            style: 'default',
            trafficLightPosition: null
          },
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

  const macWindowChrome =
    process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: macTitlebar.trafficLightPosition
        }
      : {};

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#ffffff',
    show: false,
    title: 'Thingtime',
    ...macWindowChrome,
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
ipcMain.handle('thingtime-desktop:ai-discover', (event) => discoverAiSources(event));
ipcMain.handle('thingtime-desktop:ai-begin-sync', (event, request) => beginAiSync(event, request));
ipcMain.handle('thingtime-desktop:ai-read-batch', (event, request) => readAiSyncBatch(event, request));
ipcMain.handle('thingtime-desktop:ai-cancel-sync', (event, request) => cancelAiSync(event, request));
ipcMain.handle('thingtime-desktop:node-status', (event) => nodeGetStatus(event));
ipcMain.handle('thingtime-desktop:node-register-service', (event) => nodeRegisterService(event));
ipcMain.handle('thingtime-desktop:node-unregister-service', (event) => nodeUnregisterService(event));
ipcMain.handle('thingtime-desktop:node-begin-pairing', (event) => nodeBeginPairing(event));
ipcMain.handle('thingtime-desktop:node-complete-pairing', (event, request) => nodeCompletePairing(event, request));
ipcMain.handle('thingtime-desktop:node-resume-pairing', (event, request) => nodeResumePairing(event, request));
ipcMain.handle('thingtime-desktop:node-unpair', (event, request) => nodeUnpair(event, request));
ipcMain.handle('thingtime-desktop:node-permissions', (event) => nodeGetPermissions(event));
ipcMain.handle('thingtime-desktop:node-open-permission-settings', (event, request) => nodeOpenPermissionSettings(event, request));
ipcMain.handle('thingtime-desktop:node-add-project', (event) => nodeAddProject(event));
ipcMain.handle('thingtime-desktop:node-connector', (event, request) => nodeConnectorCommand(event, request));
ipcMain.handle('thingtime-desktop:node-device', (event, request) => nodeDeviceCommand(event, request));

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

	app
		.whenReady()
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
