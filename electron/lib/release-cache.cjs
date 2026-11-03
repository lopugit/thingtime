'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isAllowedGithubReleaseAssetUrl } = require('./github-release-catalog.cjs');

const APP_NAME = 'Thingtime.app';
const CACHE_FORMAT = 1;
const MAX_CACHED_BUNDLES = 12;

function commandFailure(result, label) {
	const detail = result.error ? result.error.message : String(result.stderr || result.stdout || `exit ${result.status}`).trim();
	return new Error(`${label} failed (${detail}).`);
}

function runRequiredAsync(command, args, label) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (status) => {
			if (status === 0) resolve();
			else reject(commandFailure({ status, stderr, stdout }, label));
		});
	});
}

function safeString(value, fallback = null, maximum = 240) {
	if (typeof value !== 'string') return fallback;
	const trimmed = value.trim();
	return trimmed && trimmed.length <= maximum && !/[\0\r\n]/u.test(trimmed) ? trimmed : fallback;
}

function releaseVersion(value) {
	const match = safeString(value, '')?.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)/u);
	return match?.[1] || null;
}

function scoreZipAsset(asset) {
	const name = safeString(asset?.name, '') || '';
	const downloadUrl = safeString(asset?.browser_download_url, '') || '';
	if (!downloadUrl || !isAllowedGithubReleaseAssetUrl(downloadUrl)) return -1;
	if (!/\.zip$/iu.test(name)) return -1;
	// The standalone recovery launcher is deliberately published beside the
	// desktop ZIP. It has a different bundle identifier and cache contract, so
	// the Electron updater must never mistake it for a Thingtime.app update.
	if (/thingtime[- ]recovery|recovery[- ]app/iu.test(name)) return -1;
	const haystack = `${name} ${safeString(asset?.label, '') || ''} ${safeString(asset?.content_type, '') || ''}`.toLowerCase();
	let score = 100;
	if (haystack.includes('thingtime')) score += 40;
	if (haystack.includes('electron')) score += 30;
	if (haystack.includes('mac') || haystack.includes('darwin') || haystack.includes('arm64') || haystack.includes('universal')) score += 20;
	return score;
}

function selectCacheableAsset(assets) {
	const entry = (Array.isArray(assets) ? assets : [])
		.map((asset) => ({ asset, score: scoreZipAsset(asset) }))
		.filter((candidate) => candidate.score >= 0)
		.sort((left, right) => right.score - left.score || String(left.asset.name).localeCompare(String(right.asset.name)))[0];
	if (!entry) return null;
	return {
		contentType: safeString(entry.asset.content_type),
		downloadUrl: safeString(entry.asset.browser_download_url),
		label: safeString(entry.asset.label),
		name: safeString(entry.asset.name),
		size: Number.isSafeInteger(entry.asset.size) && entry.asset.size >= 0 ? entry.asset.size : null
	};
}

function branchDetails(version) {
	const match = safeString(version, '')?.match(/^\d+\.\d+\.\d+-pr\.(\d+)\.([a-z0-9-]+)\.g([0-9a-f]{7,40})$/iu);
	if (!match) return { branch: null, commit: null, pullRequestNumber: null };
	return { branch: match[2], commit: match[3], pullRequestNumber: Number(match[1]) };
}

function releaseCatalog(rawReleases, currentVersion = null) {
	const current = releaseVersion(currentVersion);
	return (Array.isArray(rawReleases) ? rawReleases : [])
		.filter((release) => release && release.draft !== true)
		.map((release) => {
			const tag = safeString(release.tag_name, safeString(release.name, ''));
			const version = releaseVersion(tag || release.name);
			const details = branchDetails(version);
			return {
				asset: selectCacheableAsset(release.assets),
				branch: details.branch,
				commit: details.commit,
				id: String(release.id ?? tag ?? crypto.createHash('sha256').update(JSON.stringify(release)).digest('hex').slice(0, 16)),
				isCurrent: Boolean(current && version && current === version),
				isPrerelease: release.prerelease === true,
				name: safeString(release.name, tag),
				publishedAt: safeString(release.published_at),
				pullRequestNumber: details.pullRequestNumber,
				releaseUrl: safeString(release.html_url),
				tag,
				version
			};
		})
		.filter((release) => release.tag)
		.sort((left, right) => String(right.publishedAt || '').localeCompare(String(left.publishedAt || '')) || String(right.tag).localeCompare(String(left.tag)));
}

function cacheKey(release) {
	const readable = String(release?.tag || release?.version || 'release')
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		.slice(0, 80) || 'release';
	const digest = crypto.createHash('sha256').update(String(release?.id || release?.tag || readable)).digest('hex').slice(0, 12);
	return `${readable}-${digest}`;
}

function resolveWithin(root, candidate, label) {
	const rootPath = path.resolve(root);
	const target = path.resolve(candidate);
	if (target === rootPath || !target.startsWith(`${rootPath}${path.sep}`)) throw new Error(`${label} must remain inside the Thingtime update cache.`);
	return target;
}

function cachePaths(cacheRoot, release) {
	const root = path.resolve(cacheRoot);
	const key = cacheKey(release);
	const bundleDirectory = resolveWithin(root, path.join(root, 'bundles', key), 'Cache destination');
	return {
		appPath: path.join(bundleDirectory, APP_NAME),
		bundleDirectory,
		key,
		manifestPath: path.join(root, 'manifest.json'),
		root
	};
}

function ensureRegularDirectory(directory, label) {
	try {
		const stat = fs.lstatSync(directory);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a regular directory.`);
	} catch (error) {
		if (error?.code !== 'ENOENT') throw error;
		fs.mkdirSync(directory, { mode: 0o700 });
		const created = fs.lstatSync(directory);
		if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(`${label} must be a regular directory.`);
	}
	fs.chmodSync(directory, 0o700);
}

function ensureCacheRoot(root) {
	const cacheRoot = path.resolve(root);
	try {
		fs.mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
	} catch (error) {
		throw new Error(`Thingtime update cache could not be created (${error instanceof Error ? error.message : String(error)}).`);
	}
	ensureRegularDirectory(cacheRoot, 'Thingtime update cache');
	ensureRegularDirectory(path.join(cacheRoot, 'bundles'), 'Thingtime update cache bundles directory');
}

function readManifest(cacheRoot) {
	const manifestPath = path.join(path.resolve(cacheRoot), 'manifest.json');
	try {
		const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
		if (parsed?.format !== CACHE_FORMAT || !Array.isArray(parsed.entries)) return { entries: [], format: CACHE_FORMAT };
		return { entries: parsed.entries.filter((entry) => entry && typeof entry === 'object'), format: CACHE_FORMAT };
	} catch (error) {
		if (error?.code === 'ENOENT') return { entries: [], format: CACHE_FORMAT };
		throw new Error('Thingtime update cache metadata is unreadable.');
	}
}

function writeManifest(cacheRoot, manifest) {
	const root = path.resolve(cacheRoot);
	const destination = path.join(root, 'manifest.json');
	const temporary = path.join(root, `.manifest-${process.pid}-${crypto.randomUUID()}.json`);
	fs.writeFileSync(temporary, `${JSON.stringify({ ...manifest, format: CACHE_FORMAT }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
	fs.renameSync(temporary, destination);
	fs.chmodSync(destination, 0o600);
}

async function sha256File(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function assertBundlePath(appPath) {
	const stat = fs.lstatSync(appPath);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Cached update does not contain a regular Thingtime.app bundle.');
	return appPath;
}

function assertBundleDirectory(bundleDirectory) {
	const stat = fs.lstatSync(bundleDirectory);
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Cached update bundle directory is not a regular directory.');
	return bundleDirectory;
}

function getCachedBundles(cacheRoot) {
	const root = path.resolve(cacheRoot);
	ensureCacheRoot(root);
	const manifest = readManifest(root);
	const entries = [];
	for (const entry of manifest.entries) {
		try {
			const bundleDirectory = resolveWithin(root, path.join(root, 'bundles', String(entry.key || '')), 'Cached bundle');
			const appPath = resolveWithin(bundleDirectory, path.join(bundleDirectory, APP_NAME), 'Cached app');
			assertBundleDirectory(bundleDirectory);
			assertBundlePath(appPath);
			entries.push({
				...entry,
				appPath,
				cacheState: 'ready'
			});
		} catch {
			// A missing or tampered cache entry never becomes executable state.
		}
	}
	return entries.sort((left, right) => String(right.cachedAt || '').localeCompare(String(left.cachedAt || '')));
}

function recoverableManifestEntries(cacheRoot, manifest) {
	const recoverableKeys = new Set(getCachedBundles(cacheRoot).map((entry) => entry.key));
	return manifest.entries.filter((entry) => typeof entry?.key === 'string' && recoverableKeys.has(entry.key));
}

async function cacheReleaseArchive({ archivePath, cacheRoot, release, verifyApp }) {
	if (typeof verifyApp !== 'function') throw new Error('Thingtime update verification is unavailable.');
	const paths = cachePaths(cacheRoot, release);
	ensureCacheRoot(paths.root);
	const existing = getCachedBundles(paths.root).find((entry) => entry.key === paths.key);
	if (existing) return { ...existing, alreadyCached: true };
	const manifest = readManifest(paths.root);
	const preservedEntries = recoverableManifestEntries(paths.root, manifest);
	if (preservedEntries.length >= MAX_CACHED_BUNDLES) {
		throw new Error(`Thingtime keeps up to ${MAX_CACHED_BUNDLES} verified recovery bundles. Remove one cached bundle before adding another.`);
	}
	const source = path.resolve(archivePath);
	const archive = fs.lstatSync(source);
	if (!archive.isFile() || archive.isSymbolicLink() || !/\.zip$/iu.test(source)) throw new Error('Thingtime can cache only a regular signed macOS ZIP release asset.');
	const stagingRoot = await fsp.mkdtemp(path.join(paths.root, '.extract-'));
	let bundleDirectoryCreated = false;
	try {
		await runRequiredAsync('/usr/bin/ditto', ['-x', '-k', source, stagingRoot], 'Thingtime update archive extraction');
		const stagedApp = path.join(stagingRoot, APP_NAME);
		assertBundlePath(stagedApp);
		await verifyApp(stagedApp);
		fs.mkdirSync(paths.bundleDirectory, { recursive: false, mode: 0o700 });
		bundleDirectoryCreated = true;
		const cachedApp = path.join(paths.bundleDirectory, APP_NAME);
		await runRequiredAsync('/usr/bin/ditto', ['--rsrc', '--extattr', stagedApp, cachedApp], 'Thingtime recovery bundle copy');
		assertBundlePath(cachedApp);
		await verifyApp(cachedApp);
		const entry = {
			assetName: safeString(release?.asset?.name),
			branch: safeString(release?.branch),
			cachedAt: new Date().toISOString(),
			commit: safeString(release?.commit),
			key: paths.key,
			name: safeString(release?.name),
			pullRequestNumber: Number.isSafeInteger(release?.pullRequestNumber) ? release.pullRequestNumber : null,
			releaseUrl: safeString(release?.releaseUrl),
			sourceSha256: await sha256File(source),
			tag: safeString(release?.tag),
			version: safeString(release?.version)
		};
		writeManifest(paths.root, { entries: [entry, ...preservedEntries], format: CACHE_FORMAT });
		return { ...entry, appPath: cachedApp, alreadyCached: false, cacheState: 'ready' };
	} catch (error) {
		if (bundleDirectoryCreated) fs.rmSync(paths.bundleDirectory, { force: true, recursive: true });
		throw error;
	} finally {
		await fsp.rm(stagingRoot, { force: true, recursive: true });
	}
}

async function cacheInstalledBundle({ cacheRoot, release, sourceApp, verifyApp }) {
	if (typeof verifyApp !== 'function') throw new Error('Thingtime recovery verification is unavailable.');
	const paths = cachePaths(cacheRoot, release);
	ensureCacheRoot(paths.root);
	const existing = getCachedBundles(paths.root).find((entry) => entry.key === paths.key);
	if (existing) return { ...existing, alreadyCached: true };
	const manifest = readManifest(paths.root);
	const preservedEntries = recoverableManifestEntries(paths.root, manifest);
	if (preservedEntries.length >= MAX_CACHED_BUNDLES) {
		throw new Error(`Thingtime keeps up to ${MAX_CACHED_BUNDLES} verified recovery bundles. Remove one cached bundle before changing versions.`);
	}
	assertBundlePath(sourceApp);
	await verifyApp(sourceApp);
	fs.mkdirSync(paths.bundleDirectory, { recursive: false, mode: 0o700 });
	const cachedApp = path.join(paths.bundleDirectory, APP_NAME);
	try {
		await runRequiredAsync('/usr/bin/ditto', ['--rsrc', '--extattr', sourceApp, cachedApp], 'Thingtime current-version recovery copy');
		assertBundlePath(cachedApp);
		await verifyApp(cachedApp);
		const entry = {
			assetName: null,
			branch: safeString(release?.branch),
			cachedAt: new Date().toISOString(),
			commit: safeString(release?.commit),
			key: paths.key,
			name: safeString(release?.name, 'Previously installed Thingtime'),
			pullRequestNumber: Number.isSafeInteger(release?.pullRequestNumber) ? release.pullRequestNumber : null,
			releaseUrl: null,
			sourceSha256: null,
			tag: safeString(release?.tag),
			version: safeString(release?.version)
		};
		writeManifest(paths.root, { entries: [entry, ...preservedEntries], format: CACHE_FORMAT });
		return { ...entry, appPath: cachedApp, alreadyCached: false, cacheState: 'ready' };
	} catch (error) {
		fs.rmSync(paths.bundleDirectory, { force: true, recursive: true });
		throw error;
	}
}

function removeCachedBundle({ cacheRoot, key }) {
	const root = path.resolve(cacheRoot);
	ensureCacheRoot(root);
	const manifest = readManifest(root);
	const entry = manifest.entries.find((candidate) => candidate?.key === key);
	if (!entry) throw new Error('That Thingtime recovery bundle is no longer cached.');
	const bundleDirectory = resolveWithin(root, path.join(root, 'bundles', key), 'Cached bundle');
	fs.rmSync(bundleDirectory, { force: true, recursive: true });
	writeManifest(root, { entries: manifest.entries.filter((candidate) => candidate?.key !== key), format: CACHE_FORMAT });
	return { key };
}

module.exports = {
	APP_NAME,
	MAX_CACHED_BUNDLES,
	branchDetails,
	cacheInstalledBundle,
	cacheReleaseArchive,
	getCachedBundles,
	removeCachedBundle,
	releaseCatalog,
	selectCacheableAsset
};
