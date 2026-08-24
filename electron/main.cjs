const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { app, BrowserWindow, dialog, ipcMain, shell, Menu, nativeImage, session } = require('electron');
const { checkEndpointCompatibility, compatibilityError, probeEndpointDevices } = require('./lib/endpoint-compatibility.cjs');
const { DesktopSettingsStore } = require('./lib/desktop-settings.cjs');
const {
	cacheInstalledBundle,
	cacheReleaseArchive,
	getCachedBundles,
	removeCachedBundle,
	releaseCatalog
} = require('./lib/release-cache.cjs');
const { migrateLegacyReleaseCache, sharedReleaseCacheRoot } = require('./lib/shared-release-cache.cjs');
const {
	fetchGithubReleaseCatalog: fetchAllGithubReleasePages,
	isAllowedGithubReleaseAssetUrl,
	releaseCatalogState
} = require('./lib/github-release-catalog.cjs');
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
const electronReleaseLabel = process.env.THINGTIME_DESKTOP_RELEASE_LABEL || 'Electron App Release';
const updateFeedUrl = process.env.THINGTIME_DESKTOP_UPDATE_FEED_URL || 'https://api.github.com/repos/lopugit/thingtime/releases?per_page=100';
const maxUpdateArchiveBytes = 5 * 1024 * 1024 * 1024;
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
let desktopSettings = null;
let desktopSettingsLastError = null;
let endpointCompatibility = null;
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

function setApiFallbackEndpoint(rawUrl) {
	const endpointUrl = normalizeDesktopUrl(rawUrl);
	process.env.THINGTIME_API_FALLBACK_ORIGIN = new URL(endpointUrl).origin;
	return endpointUrl;
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

function requestJsonResponse(url, redirectCount = 0) {
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
          resolve(requestJsonResponse(new URL(location, url).href, redirectCount + 1));
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
            resolve({ headers: response.headers, value: null });
            return;
          }

          if (statusCode >= 400) {
            reject(new Error(`Update feed returned HTTP ${statusCode}.`));
            return;
          }

          try {
            resolve({ headers: response.headers, value: JSON.parse(body || 'null') });
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

async function requestJson(url) {
  const response = await requestJsonResponse(url);
  return response.value;
}

async function fetchGithubReleaseCatalog() {
	return fetchAllGithubReleasePages(updateFeedUrl, requestJsonResponse);
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

	return (cleaned || 'Thingtime-Electron-App-Release.zip').slice(0, 180);
}

function downloadFile(url, targetPath, options = {}, redirectCount = 0) {
	return new Promise((resolve, reject) => {
		if (!isAllowedGithubReleaseAssetUrl(url)) {
			reject(new Error('Thingtime update download was redirected outside GitHub release storage.'));
			return;
		}
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
						downloadFile(new URL(location, url).href, targetPath, options, redirectCount + 1).then(resolve, reject);
					});
				});
				return;
			}

			if ([301, 302, 303, 307, 308].includes(statusCode)) {
				response.resume();
				cleanup(new Error('Thingtime update download exceeded its permitted GitHub redirect limit.'));
				return;
			}

        if (statusCode >= 400) {
          response.resume();
          cleanup(new Error(`Update download returned HTTP ${statusCode}.`));
          return;
        }

        const maximumBytes = options.maximumBytes || maxUpdateArchiveBytes;
        const declaredLength = Number.parseInt(String(response.headers['content-length'] || ''), 10);
        if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
          response.resume();
          cleanup(new Error('Update download is larger than the permitted cache size.'));
          return;
        }

        let downloadedBytes = 0;
        response.on('data', (chunk) => {
          downloadedBytes += Buffer.byteLength(chunk);
          if (downloadedBytes > maximumBytes) {
            request.destroy(new Error('Update download is larger than the permitted cache size.'));
          }
        });

        response.pipe(file);
        response.on('error', cleanup);
        file.on('finish', () => {
          file.close((error) => {
            if (error) {
              cleanup(error);
              return;
            }

            if (options.expectedBytes !== undefined && options.expectedBytes !== null && downloadedBytes !== options.expectedBytes) {
              cleanup(new Error('Update download size did not match the GitHub release metadata.'));
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

function updateCacheRoot() {
	const sharedRoot = sharedReleaseCacheRoot(app.getPath('home'));
	try {
		migrateLegacyReleaseCache({ legacyRoot: path.join(app.getPath('userData'), 'release-cache'), sharedRoot });
	} catch {
		// A malformed old cache is never allowed to prevent a clean new cache.
	}
	return sharedRoot;
}

function publicCachedBundle(entry) {
  const { appPath, sourceSha256, ...publicEntry } = entry;
  return publicEntry;
}

function cacheEntryForKey(key) {
  if (typeof key !== 'string' || !/^[a-z0-9.-]{1,100}-[a-f0-9]{12}$/u.test(key)) {
    throw new Error('Thingtime update cache key is invalid.');
  }
  const entry = getCachedBundles(updateCacheRoot()).find((candidate) => candidate.key === key);
  if (!entry) throw new Error('That Thingtime version is not cached on this Mac.');
  return entry;
}

function scheduleCachedReleaseHandoff(action, entry) {
	if (!['install', 'launch'].includes(action)) throw new Error('Thingtime recovery action is invalid.');
	const installedApp = installedThingtimeApp();
	const pendingDirectory = path.join(updateCacheRoot(), 'pending');
	fs.mkdirSync(pendingDirectory, { recursive: true, mode: 0o700 });
	const planPath = path.join(pendingDirectory, `${crypto.randomUUID()}.json`);
	fs.writeFileSync(
		planPath,
		`${JSON.stringify({ action, cacheRoot: updateCacheRoot(), format: 1, sourceApp: entry.appPath, targetDir: path.dirname(installedApp), waitForPid: process.pid })}\n`,
		{ encoding: 'utf8', flag: 'wx', mode: 0o600 }
	);
	const helper = path.join(__dirname, 'scripts', 'install-cached-release.mjs');
	try {
		const child = spawn(process.execPath, [helper, planPath], {
			detached: true,
			env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
			stdio: 'ignore'
		});
		child.unref();
	} catch (error) {
		fs.rmSync(planPath, { force: true });
		throw error;
	}
	setTimeout(() => app.quit(), 100);
}

function packagedVerifierScript() {
  return path.join(__dirname, 'scripts', 'verify-signed-app.mjs');
}

async function verifyProductionReleaseApp(appPath) {
  const result = spawnSync(process.execPath, [packagedVerifierScript(), '--mode', 'production', appPath], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error('The downloaded Thingtime bundle did not pass Developer ID, notarization, and nested-code verification.');
  }
}

function installedThingtimeApp() {
  return path.join(app.getPath('home'), 'Applications', 'Thingtime.app');
}

function currentRecoveryRelease() {
  const version = getCurrentAppVersion();
  const normalized = normalizeVersionString(version) || app.getVersion();
  const details = normalized.match(/^\d+\.\d+\.\d+-pr\.(\d+)\.([a-z0-9-]+)\.g([0-9a-f]{7,40})$/iu);
  return {
    branch: details?.[2] || null,
    commit: details?.[3] || null,
    name: `Previously installed Thingtime ${normalized}`,
    pullRequestNumber: details ? Number(details[1]) : null,
    tag: `installed-${normalized}`,
    version: normalized
  };
}

async function getReleaseCatalog() {
	const currentVersion = getCurrentAppVersion();
	const cachedBundles = getCachedBundles(updateCacheRoot()).map(publicCachedBundle);
	try {
		const { releases, truncated } = await fetchGithubReleaseCatalog();
		return releaseCatalogState({
			cachedBundles,
			currentVersion,
			feedUrl: updateFeedUrl,
			releases: releaseCatalog(releases, currentVersion),
			truncated
		});
	} catch {
		return releaseCatalogState({
			cachedBundles,
			catalogError: 'GitHub releases are temporarily unavailable. Cached recovery bundles remain available on this Mac.',
			currentVersion,
			feedUrl: updateFeedUrl
		});
	}
}

async function cacheSelectedRelease(request) {
  const releaseId = typeof request?.releaseId === 'string' && request.releaseId.length <= 240 ? request.releaseId : '';
	if (!releaseId) throw new Error('Choose a Thingtime release first.');
	const catalog = await getReleaseCatalog();
	if (catalog.catalogError) throw new Error(catalog.catalogError);
	const release = catalog.releases.find((candidate) => candidate.id === releaseId);
  if (!release?.asset?.downloadUrl || !release.asset.name) {
    throw new Error('That release does not include a signed macOS ZIP bundle.');
  }
  const cacheRoot = updateCacheRoot();
  const downloadDirectory = path.join(cacheRoot, 'downloads');
  fs.mkdirSync(downloadDirectory, { recursive: true, mode: 0o700 });
  const temporaryArchive = path.join(downloadDirectory, `${crypto.randomUUID()}-${safeFileName(release.asset.name)}`);
  try {
    await downloadFile(release.asset.downloadUrl, temporaryArchive, {
      expectedBytes: release.asset.size,
      maximumBytes: maxUpdateArchiveBytes
    });
    const cachedBundle = await cacheReleaseArchive({
      archivePath: temporaryArchive,
      cacheRoot,
      release,
      verifyApp: verifyProductionReleaseApp
    });
    return { cachedBundle: publicCachedBundle(cachedBundle), catalog: await getReleaseCatalog() };
  } finally {
    await fs.promises.rm(temporaryArchive, { force: true });
  }
}

async function launchCachedRelease(request) {
	const entry = cacheEntryForKey(request?.key);
	await verifyProductionReleaseApp(entry.appPath);
	scheduleCachedReleaseHandoff('launch', entry);
	return {
		cachedBundle: publicCachedBundle(entry),
		message: `Closing this Thingtime instance and launching ${entry.version || entry.tag} as a standalone recovery bundle.`,
		status: 'relaunching'
	};
}

async function installCachedRelease(request) {
  const entry = cacheEntryForKey(request?.key);
  await verifyProductionReleaseApp(entry.appPath);
  const installedApp = installedThingtimeApp();
  if (!fs.existsSync(installedApp)) throw new Error('The standard ~/Applications/Thingtime.app install is missing; launch the cached bundle instead.');
  await cacheInstalledBundle({
    cacheRoot: updateCacheRoot(),
    release: currentRecoveryRelease(),
    sourceApp: installedApp,
    verifyApp: verifyProductionReleaseApp
  });
	scheduleCachedReleaseHandoff('install', entry);
  return { cachedBundle: publicCachedBundle(entry), message: `Switching to ${entry.version || entry.tag} and keeping the current version as a recovery bundle.`, status: 'relaunching' };
}

async function removeCachedRelease(request) {
  const key = typeof request?.key === 'string' ? request.key : '';
  removeCachedBundle({ cacheRoot: updateCacheRoot(), key });
  return getReleaseCatalog();
}

function revealUpdateCache() {
  const root = updateCacheRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  shell.showItemInFolder(root);
  return { cachePath: root };
}

async function downloadUpdateBundle() {
  const catalog = await getReleaseCatalog();
  const release = catalog.releases.find((candidate) => candidate.asset && !candidate.isCurrent) || catalog.releases.find((candidate) => candidate.asset);
  if (!release) throw new Error('No signed macOS ZIP bundle is available in the GitHub release catalog.');
  const result = await cacheSelectedRelease({ releaseId: release.id });
  return {
    asset: release.asset,
    cachedBundle: result.cachedBundle,
    checkedAt: result.catalog.checkedAt,
    currentVersion: result.catalog.currentVersion,
    downloadedAt: new Date().toISOString(),
    latestVersion: release.version,
    message: `Verified and cached ${release.version || release.tag}. Choose Install to switch to it.`,
    releaseName: release.name,
    releaseUrl: release.releaseUrl,
    status: 'available',
    updateAvailable: !release.isCurrent
  };
}

function isAllowedContentUrl(targetUrl) {
  if (!targetUrl || targetUrl === 'about:blank') {
    return true;
  }

  try {
    const origin = new URL(targetUrl).origin;
    return origin === appOrigin;
  } catch {
    return false;
  }
}

function trustedAiBridgeOrigins() {
  const configured = String(process.env.THINGTIME_DESKTOP_AI_TRUSTED_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
	return new Set([appOrigin, ...configured].filter(Boolean));
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

function requireRendererMatchesConfiguredNode(event) {
	const frameUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
	let pageOrigin;
	try {
		pageOrigin = new URL(frameUrl).origin;
	} catch {
		throw new ThingtimeNodeBridgeError('endpoint_mismatch', 'Open a configured Thingtime page before pairing this Mac.');
	}
	if (!appOrigin || pageOrigin !== new URL(appOrigin).origin) {
		throw new ThingtimeNodeBridgeError(
			'endpoint_mismatch',
			'This request did not come from the bundled Thingtime interface. Reopen the installed Thingtime app, then pair again.'
		);
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

function configuredNodeRegistration() {
	if (!desktopSettings) throw new Error('Thingtime desktop settings are not ready.');
	return {
		...desktopSettings.nodeRegistration(),
		projectRegistryPath: nodeProjectRegistryPath()
	};
}

async function reconcileConfiguredNode({ startIfStopped } = {}) {
	if (process.platform !== 'darwin' || !desktopSettings) return null;
	if (endpointCompatibility && endpointCompatibility.status !== 'compatible') return thingtimeNode.status();
	await ensureLocalProjectRegistry(nodeProjectRegistryPath());
	const shouldStart = typeof startIfStopped === 'boolean' ? startIfStopped : desktopSettings.snapshot().autoStartNodeOnLaunch;
	return thingtimeNode.reconcileRegisteredService(configuredNodeRegistration(), { startIfStopped: shouldStart });
}

async function initializeDesktopSettings() {
	desktopSettings = new DesktopSettingsStore({
		filePath: path.join(app.getPath('userData'), 'desktop-settings.json'),
		metadata: readWebBuildMetadata()
	});
	const settings = await desktopSettings.initialize();
	setApiFallbackEndpoint(settings.selectedEndpoint.url);
	endpointCompatibility = { checkedAt: new Date().toISOString(), message: 'Checking computers API compatibility…', status: 'checking' };
	return desktopSettings.snapshot();
}

async function checkSelectedEndpointCompatibility({ syncNode = false } = {}) {
	const selected = requireDesktopSettings().snapshot().selectedEndpoint;
	endpointCompatibility = { checkedAt: new Date().toISOString(), message: 'Checking computers API compatibility…', status: 'checking' };
	const compatibility = await checkEndpointCompatibility({
		endpointUrl: selected.url,
		origin: appOrigin,
		userAgent: `Thingtime/${getCurrentAppVersion()}`
	});
	endpointCompatibility = compatibility;
	if (compatibility.status !== 'compatible' || !syncNode) return compatibility;
	try {
		await reconcileConfiguredNode();
		desktopSettingsLastError = null;
	} catch (error) {
		desktopSettingsLastError = error instanceof Error ? error.message : String(error);
		console.warn('Unable to reconcile Thingtime Node configuration', error);
	}
	return compatibility;
}

async function nodeRegisterService(event) {
	requireMacNode(event);
	const compatibility = await checkSelectedEndpointCompatibility();
	if (compatibility.status !== 'compatible') throw compatibilityError(compatibility);
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
	return thingtimeNode.registerService({ ...configuredNodeRegistration(), projectRegistryPath });
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
	const status = await thingtimeNode.registerService({ ...configuredNodeRegistration(), projectRegistryPath });
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
	requireRendererMatchesConfiguredNode(event);
	const pairingSecret = typeof request?.pairingSecret === 'string' ? request.pairingSecret : '';
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!pairingSecret || !commandId) {
		throw new ThingtimeNodeBridgeError('invalid_request', 'Pairing requires a secret and commandId.');
	}
	// The signed helper presents the authoritative local-presence confirmation.
	// Avoid stacking a second Electron dialog in front of it.
	await thingtimeNode.request('pairing.claim', { pairingSecret }, commandId);
	return thingtimeNode.status();
}

async function nodeResumePairing(event, request) {
	requireMacNode(event);
	requireRendererMatchesConfiguredNode(event);
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!commandId) throw new ThingtimeNodeBridgeError('invalid_request', 'Resuming pairing requires a commandId.');
	await thingtimeNode.request('pairing.resume', {}, commandId);
	return thingtimeNode.status();
}

async function nodeUnpair(event, request) {
	requireMacNode(event);
	const commandId = typeof request?.commandId === 'string' ? request.commandId : '';
	if (!commandId) throw new ThingtimeNodeBridgeError('invalid_request', 'Unpairing requires a commandId.');
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
	const permissions = normalizePermissions(await thingtimeNode.request('permissions.request', { kind }, `permission-${crypto.randomUUID()}`));
	shell.showItemInFolder(paths.helperApp);
	await shell.openExternal(permission.url);
	return { kind, opened: true, permissions: permissions.permissions };
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
		case 'system.audio.mute.set':
			return { message: 'Change this Mac\'s audio mute state?', confirmLabel: 'Change Mute' };
		case 'system.audio.input.volume.set':
			return { message: 'Change this Mac\'s microphone input level?', confirmLabel: 'Set Microphone Level' };
		case 'system.audio.input.mute.set':
			return { message: 'Change this Mac\'s microphone mute state?', confirmLabel: 'Change Microphone Mute' };
		case 'system.audio.output.set':
			return { message: 'Switch this Mac\'s default audio output device?', confirmLabel: 'Switch Output' };
		case 'system.audio.input.set':
			return { message: 'Switch this Mac\'s default audio input device?', confirmLabel: 'Switch Input' };
		case 'system.audio.sound-effects-output.set':
			return { message: 'Switch this Mac\'s sound-effects output device?', confirmLabel: 'Switch Sound Effects' };
		case 'system.audio.sound-effects.volume.set':
			return { message: 'Change this Mac\'s alerts and sound-effects level?', confirmLabel: 'Set Alerts Level' };
		case 'system.audio.sound-effects.mute.set':
			return { message: 'Change this Mac\'s alerts and sound-effects mute state?', confirmLabel: 'Change Alerts Mute' };
		case 'system.wifi.connect':
			return { message: 'Connect this Mac to the requested available Wi-Fi network using only an existing local credential?', confirmLabel: 'Connect Wi-Fi' };
		case 'system.wifi.disconnect':
			return { message: 'Disconnect this Mac from Wi-Fi? This may end the current remote session.', confirmLabel: 'Disconnect Wi-Fi' };
		case 'system.wifi.power.set':
			return { message: 'Change this Mac\'s Wi-Fi power state? This may end the current remote session.', confirmLabel: 'Change Wi-Fi Power' };
		case 'system.lock':
			return { message: 'Lock this Mac now?', confirmLabel: 'Lock Mac' };
		case 'system.sleep':
			return { message: 'Put this Mac to sleep now? It will need to wake locally before it can reconnect.', confirmLabel: 'Sleep Mac' };
		case 'application.activate':
			return { message: 'Bring the requested application to the front?', confirmLabel: 'Activate App' };
		case 'application.launch':
			return { message: 'Launch the requested application on this Mac?', confirmLabel: 'Launch App' };
		case 'application.force-quit':
			return { message: 'Force quit the requested application? Unsaved work in that app may be lost.', confirmLabel: 'Force Quit App' };
		case 'application.hide-others':
			return { message: 'Hide every other running application on this Mac?', confirmLabel: 'Hide Other Apps' };
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

function requireDesktopSettings() {
	if (!desktopSettings) throw new Error('Thingtime desktop settings are not ready.');
	return desktopSettings;
}

async function switchDesktopEndpoint(endpointId, { confirm = true } = {}) {
	const settings = requireDesktopSettings();
	const before = settings.snapshot();
	const target = before.endpointProfiles.find((entry) => entry.id === String(endpointId || ''));
	if (!target) throw new Error('Choose a known Thingtime API endpoint.');
	if (target.id === before.selectedEndpointId) {
		setApiFallbackEndpoint(target.url);
		const compatibility = await checkSelectedEndpointCompatibility({ syncNode: true });
		if (compatibility.status !== 'compatible') throw compatibilityError(compatibility);
		if (mainWindow && appOrigin) await loadBundledRenderer();
		return getDesktopInfo();
	}
	const directCompatibility = await probeEndpointDevices(target.url, { userAgent: `Thingtime/${getCurrentAppVersion()}` });
	if (directCompatibility.status !== 'compatible') throw compatibilityError(directCompatibility);
	if (confirm) {
		const approved = await confirmNodeChange({
			title: 'Switch Thingtime API endpoint?',
			message: `Use ${target.label} for this Thingtime app and Mac node?`,
			detail: `${target.url}\n\nThe bundled Thingtime interface stays on this Mac. Its account data and Thingtime Node will use this API endpoint. Pairing is kept separately for each endpoint.`,
			confirmLabel: 'Switch Endpoint'
		});
		if (!approved) return getDesktopInfo();
	}
	try {
		await settings.selectEndpoint(target.id);
		setApiFallbackEndpoint(target.url);
		const compatibility = await checkSelectedEndpointCompatibility({ syncNode: true });
		if (compatibility.status !== 'compatible') throw compatibilityError(compatibility);
		await loadBundledRenderer();
		desktopSettingsLastError = null;
		createApplicationMenu();
		return getDesktopInfo();
	} catch (error) {
		await settings.selectEndpoint(before.selectedEndpointId);
		setApiFallbackEndpoint(before.selectedEndpoint.url);
		let rollbackError = null;
		try {
			await checkSelectedEndpointCompatibility({ syncNode: true });
			await loadBundledRenderer();
		} catch (caughtRollbackError) {
			rollbackError = caughtRollbackError;
		}
		desktopSettingsLastError = rollbackError instanceof Error ? rollbackError.message : rollbackError ? String(rollbackError) : null;
		createApplicationMenu();
		throw error;
	}
}

async function desktopSelectEndpoint(event, request) {
	requireTrustedAiBridgeEvent(event);
	return switchDesktopEndpoint(request?.endpointId);
}

async function desktopCheckEndpointCompatibility(event) {
	requireTrustedAiBridgeEvent(event);
	await checkSelectedEndpointCompatibility({ syncNode: true });
	return getDesktopInfo();
}

async function desktopAddEndpoint(event, request) {
	requireTrustedAiBridgeEvent(event);
	const settings = await requireDesktopSettings().addEndpoint({ label: request?.label, url: request?.url });
	createApplicationMenu();
	return settings;
}

async function desktopRemoveEndpoint(event, request) {
	requireTrustedAiBridgeEvent(event);
	const settings = await requireDesktopSettings().removeEndpoint(request?.endpointId);
	createApplicationMenu();
	return settings;
}

async function selectMenuBarIcon(iconId, customIconPath) {
	const settings = requireDesktopSettings();
	const previous = settings.snapshot().selectedMenuBarIconId;
	try {
		const snapshot = await settings.selectMenuBarIcon(iconId, customIconPath);
		await reconcileConfiguredNode();
		desktopSettingsLastError = null;
		return snapshot;
	} catch (error) {
		await settings.selectMenuBarIcon(previous);
		throw error;
	}
}

async function desktopSelectMenuBarIcon(event, request) {
	requireTrustedAiBridgeEvent(event);
	return selectMenuBarIcon(request?.iconId);
}

async function desktopSetNodeAutoStart(event, request) {
	requireTrustedAiBridgeEvent(event);
	const settings = requireDesktopSettings();
	const previous = settings.snapshot().autoStartNodeOnLaunch;
	const snapshot = await settings.setAutoStartNodeOnLaunch(request?.enabled);
	if (!snapshot.autoStartNodeOnLaunch) return snapshot;
	try {
		await reconcileConfiguredNode({ startIfStopped: true });
		desktopSettingsLastError = null;
		return settings.snapshot();
	} catch (error) {
		await settings.setAutoStartNodeOnLaunch(previous);
		desktopSettingsLastError = error instanceof Error ? error.message : String(error);
		throw error;
	}
}

async function desktopUploadMenuBarIcon(event) {
	requireTrustedAiBridgeEvent(event);
	const selection = await dialog.showOpenDialog(mainWindow || undefined, {
		title: 'Choose a Thingtime Node menu bar icon',
		buttonLabel: 'Use Icon',
		properties: ['openFile'],
		filters: [
			{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'gif'] },
			{ name: 'All files', extensions: ['*'] }
		]
	});
	if (selection.canceled || selection.filePaths.length !== 1) return { cancelled: true };
	const sourcePath = selection.filePaths[0];
	const sourceStat = await fs.promises.lstat(sourcePath);
	if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > 10 * 1024 * 1024) {
		throw new Error('Choose a regular image no larger than 10 MB.');
	}
	const image = nativeImage.createFromPath(sourcePath);
	if (image.isEmpty()) throw new Error('That file is not a readable image.');
	const dimensions = image.getSize();
	const scale = Math.min(1, 256 / Math.max(dimensions.width, dimensions.height));
	const normalized =
		scale < 1
			? image.resize({
					width: Math.max(1, Math.round(dimensions.width * scale)),
					height: Math.max(1, Math.round(dimensions.height * scale)),
					quality: 'best'
			  })
			: image;
	const png = normalized.toPNG();
	if (!png.length || png.length > 4 * 1024 * 1024) throw new Error('The normalized icon is too large.');
	const directory = path.join(app.getPath('userData'), 'thingtime-node');
	const targetPath = path.join(directory, 'menu-bar-custom.png');
	const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await fs.promises.mkdir(directory, { mode: 0o700, recursive: true });
	try {
		await fs.promises.writeFile(temporaryPath, png, { flag: 'wx', mode: 0o600 });
		await fs.promises.rename(temporaryPath, targetPath);
		await fs.promises.chmod(targetPath, 0o600);
	} finally {
		await fs.promises.rm(temporaryPath, { force: true });
	}
	return { cancelled: false, settings: await selectMenuBarIcon('custom', targetPath) };
}

function getDesktopInfo() {
  return {
    appVersion: getCurrentAppVersion(),
    contentOrigin: activeContentOrigin || appOrigin,
    currentUrl: mainWindow?.webContents.getURL() || appOrigin,
		desktopSettings: desktopSettings?.snapshot() || null,
		desktopSettingsLastError,
		endpointCompatibility,
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

async function loadBundledRenderer() {
  if (!mainWindow) {
    throw new Error('Thingtime desktop window is not ready yet.');
  }
	if (!appOrigin) throw new Error('The bundled Thingtime interface is not ready yet.');
	activeContentOrigin = new URL(appOrigin).origin;
	await mainWindow.loadURL(appOrigin);

  return getDesktopInfo();
}

async function selectAndLoadDesktopUrl(rawUrl) {
	const targetUrl = normalizeDesktopUrl(rawUrl);
	const settings = requireDesktopSettings();
	let snapshot = settings.snapshot();
	let target = snapshot.endpointProfiles.find((entry) => entry.url === targetUrl);
	if (!target) {
		const parsed = new URL(targetUrl);
		const label = parsed.protocol === 'http:' ? `Local development · ${parsed.host}` : parsed.host;
		snapshot = await settings.addEndpoint({ label, url: targetUrl });
		target = snapshot.endpointProfiles.find((entry) => entry.url === targetUrl);
	}
	if (!target) throw new Error('Thingtime could not save that API endpoint.');
	if (target.id !== snapshot.selectedEndpointId) return switchDesktopEndpoint(target.id);
	setApiFallbackEndpoint(target.url);
	return loadBundledRenderer();
}

function showLoadUrlError(error) {
  dialog.showErrorBox('Thingtime URL failed', error instanceof Error ? error.message : String(error));
}

function createApplicationMenu() {
	const endpointSettings = desktopSettings?.snapshot();
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
					label: 'API Endpoint',
					submenu: (endpointSettings?.endpointProfiles || []).map((endpoint) => ({
						label: endpoint.label,
						type: 'radio',
						checked: endpoint.id === endpointSettings?.selectedEndpointId,
						click: () => switchDesktopEndpoint(endpoint.id).catch(showLoadUrlError)
					}))
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

function createWindow() {
	if (!appOrigin) throw new Error('The bundled Thingtime interface is not ready yet.');
	activeContentOrigin = new URL(appOrigin).origin;

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

	mainWindow.loadURL(appOrigin).catch((error) => {
		desktopSettingsLastError = error instanceof Error ? error.message : String(error);
		showLoadUrlError(error);
	});
}

ipcMain.handle('thingtime-desktop:get-info', () => getDesktopInfo());
ipcMain.handle('thingtime-desktop:get-settings', (event) => {
	requireTrustedAiBridgeEvent(event);
	return requireDesktopSettings().snapshot();
});
ipcMain.handle('thingtime-desktop:add-endpoint', (event, request) => desktopAddEndpoint(event, request));
ipcMain.handle('thingtime-desktop:remove-endpoint', (event, request) => desktopRemoveEndpoint(event, request));
ipcMain.handle('thingtime-desktop:select-endpoint', (event, request) => desktopSelectEndpoint(event, request));
ipcMain.handle('thingtime-desktop:check-endpoint-compatibility', (event) => desktopCheckEndpointCompatibility(event));
ipcMain.handle('thingtime-desktop:select-menu-bar-icon', (event, request) => desktopSelectMenuBarIcon(event, request));
ipcMain.handle('thingtime-desktop:upload-menu-bar-icon', (event) => desktopUploadMenuBarIcon(event));
ipcMain.handle('thingtime-desktop:set-node-auto-start', (event, request) => desktopSetNodeAutoStart(event, request));
ipcMain.handle('thingtime-desktop:load-url', (event, url) => {
	requireTrustedAiBridgeEvent(event);
	return selectAndLoadDesktopUrl(url);
});
ipcMain.handle('thingtime-desktop:check-for-updates', (event) => {
  requireTrustedAiBridgeEvent(event);
  return checkForUpdates();
});
ipcMain.handle('thingtime-desktop:download-update-bundle', (event) => {
  requireTrustedAiBridgeEvent(event);
  return downloadUpdateBundle();
});
ipcMain.handle('thingtime-desktop:list-update-catalog', (event) => {
  requireTrustedAiBridgeEvent(event);
  return getReleaseCatalog();
});
ipcMain.handle('thingtime-desktop:cache-release-bundle', (event, request) => {
  requireTrustedAiBridgeEvent(event);
  return cacheSelectedRelease(request);
});
ipcMain.handle('thingtime-desktop:install-cached-release', (event, request) => {
  requireTrustedAiBridgeEvent(event);
  return installCachedRelease(request);
});
ipcMain.handle('thingtime-desktop:launch-cached-release', (event, request) => {
  requireTrustedAiBridgeEvent(event);
  return launchCachedRelease(request);
});
ipcMain.handle('thingtime-desktop:remove-cached-release', (event, request) => {
  requireTrustedAiBridgeEvent(event);
  return removeCachedRelease(request);
});
ipcMain.handle('thingtime-desktop:reveal-update-cache', (event) => {
  requireTrustedAiBridgeEvent(event);
  return revealUpdateCache();
});
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
		.then(async () => {
			// The renderer is packaged locally, but Chromium's HTTP cache is shared
			// across launches while our loopback port is intentionally ephemeral. A
			// recycled port must never resurrect an old root-data response (including
			// its account and endpoint identity) from a previous desktop session.
			// Clearing only HTTP cache preserves cookies, account storage and all
			// user preferences while forcing the local bundle + selected API target
			// to establish the first paint afresh.
			await session.defaultSession.clearCache();
			await initializeDesktopSettings();
			await startNitroServer();
			createWindow();
      createApplicationMenu();
      void checkSelectedEndpointCompatibility({ syncNode: true }).catch((error) => {
        desktopSettingsLastError = error instanceof Error ? error.message : String(error);
        console.warn('Unable to check Thingtime API endpoint compatibility', error);
      });
    })
    .catch((error) => {
      dialog.showErrorBox('Thingtime failed to start', error instanceof Error ? error.message : String(error));
      app.quit();
    });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && appOrigin) {
		createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
