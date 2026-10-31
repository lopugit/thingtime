'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const test = require('node:test');

const {
	cacheInstalledBundle,
	cacheReleaseArchive,
	getCachedBundles,
	removeCachedBundle,
	releaseCatalog,
	selectCacheableAsset
} = require('../lib/release-cache.cjs');
const { migrateLegacyReleaseCache, recoveryApplicationCacheRoot, sharedReleaseCacheRoot } = require('../lib/shared-release-cache.cjs');

const verified = async () => undefined;

test('desktop and standalone recovery use stable version-independent Application Support cache roots', () => {
	assert.equal(
		sharedReleaseCacheRoot('/Users/example'),
		'/Users/example/Library/Application Support/com.thingtime.desktop/release-cache'
	);
	assert.equal(
		recoveryApplicationCacheRoot('/Users/example'),
		'/Users/example/Library/Application Support/com.thingtime.desktop/recovery-cache'
	);
	assert.throws(() => sharedReleaseCacheRoot('relative-home'), /absolute home directory/u);
});

test('the first shared-cache lookup non-destructively carries forward a regular legacy Electron cache', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-legacy-release-cache-'));
	try {
		const legacy = path.join(root, 'legacy');
		const shared = path.join(root, 'shared');
		await mkdir(path.join(legacy, 'bundles', 'fixture-abcdef123456'), { recursive: true });
		await writeFile(path.join(legacy, 'manifest.json'), '{"format":1,"entries":[]}\n');
		assert.equal(migrateLegacyReleaseCache({ legacyRoot: legacy, sharedRoot: shared }), true);
		assert.equal(migrateLegacyReleaseCache({ legacyRoot: legacy, sharedRoot: shared }), false);
		assert.equal((await readFile(path.join(shared, 'manifest.json'), 'utf8')).includes('"format":1'), true);
		assert.equal((await readdir(path.join(legacy, 'bundles'))).length, 1);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('release catalog preserves PR SemVer provenance and only selects GitHub-hosted macOS ZIP assets', () => {
	const asset = selectCacheableAsset([
		{ name: 'Thingtime.dmg', browser_download_url: 'https://github.com/lopugit/thingtime/releases/download/v1/Thingtime.dmg' },
		{ name: 'Thingtime-macos-arm64.zip', browser_download_url: 'https://github.com/lopugit/thingtime/releases/download/v1/Thingtime-macos-arm64.zip', size: 123 }
	]);
	assert.equal(asset.name, 'Thingtime-macos-arm64.zip');
	assert.equal(asset.size, 123);
	assert.equal(selectCacheableAsset([{ name: 'Thingtime.zip', browser_download_url: 'https://example.test/Thingtime.zip' }]), null);
	assert.equal(selectCacheableAsset([{ name: 'Thingtime-Recovery-App-Release-0.1.0-macos-arm64.zip', browser_download_url: 'https://github.com/lopugit/thingtime/releases/download/v1/Thingtime-Recovery-App-Release-0.1.0-macos-arm64.zip' }]), null);

	const catalog = releaseCatalog(
		[
			{
				id: 68,
				name: 'Thingtime Desktop 0.1.0-pr.68.codex-thingtime.gabcdef123456',
				tag_name: 'electron-v0.1.0-pr.68.codex-thingtime.gabcdef123456',
				published_at: '2026-08-24T00:00:00.000Z',
				assets: [{ name: 'Thingtime-macos-arm64.zip', browser_download_url: 'https://github.com/lopugit/thingtime/releases/download/v1/Thingtime-macos-arm64.zip', size: 123 }]
			}
		],
		'0.1.0-pr.68.codex-thingtime.gabcdef123456'
	);
	assert.equal(catalog.length, 1);
	assert.equal(catalog[0].pullRequestNumber, 68);
	assert.equal(catalog[0].branch, 'codex-thingtime');
	assert.equal(catalog[0].commit, 'abcdef123456');
	assert.equal(catalog[0].isCurrent, true);
});

test('verified release and installed bundles are cached as recoverable regular app directories', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-release-cache-'));
	try {
		const sourceApp = path.join(root, 'source', 'Thingtime.app');
		await mkdir(path.join(sourceApp, 'Contents', 'MacOS'), { recursive: true });
		await writeFile(path.join(sourceApp, 'Contents', 'MacOS', 'Thingtime'), 'fixture');
		const installed = await cacheInstalledBundle({
			cacheRoot: path.join(root, 'cache'),
			release: { tag: 'installed-0.1.0', version: '0.1.0' },
			sourceApp,
			verifyApp: verified
		});
		assert.equal(installed.cacheState, 'ready');
		assert.equal(getCachedBundles(path.join(root, 'cache')).length, 1);

		const archive = path.join(root, 'Thingtime.zip');
		const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', sourceApp, archive], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		const cached = await cacheReleaseArchive({
			archivePath: archive,
			cacheRoot: path.join(root, 'cache'),
			release: {
				asset: { name: 'Thingtime.zip' },
				id: 'release-68',
				tag: 'electron-v0.1.0-pr.68.codex.gabcdef123456',
				version: '0.1.0-pr.68.codex.gabcdef123456'
			},
			verifyApp: verified
		});
		assert.equal(cached.cacheState, 'ready');
		assert.equal(getCachedBundles(path.join(root, 'cache')).length, 2);
		removeCachedBundle({ cacheRoot: path.join(root, 'cache'), key: cached.key });
		assert.equal(getCachedBundles(path.join(root, 'cache')).length, 1);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('stale cache metadata does not consume recovery slots and a failed cache write leaves no bundle behind', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-release-cache-'));
	try {
		const sourceApp = path.join(root, 'source', 'Thingtime.app');
		await mkdir(path.join(sourceApp, 'Contents', 'MacOS'), { recursive: true });
		await writeFile(path.join(sourceApp, 'Contents', 'MacOS', 'Thingtime'), 'fixture');
		const cacheRoot = path.join(root, 'cache');
		await mkdir(path.join(cacheRoot, 'bundles'), { recursive: true });
		await writeFile(path.join(cacheRoot, 'manifest.json'), `${JSON.stringify({
			format: 1,
			entries: Array.from({ length: 12 }, (_, index) => ({ key: `missing-${index}` }))
		})}\n`);

		const cached = await cacheInstalledBundle({
			cacheRoot,
			release: { tag: 'installed-0.1.1', version: '0.1.1' },
			sourceApp,
			verifyApp: verified
		});
		assert.equal(cached.cacheState, 'ready');
		const repairedManifest = JSON.parse(await readFile(path.join(cacheRoot, 'manifest.json'), 'utf8'));
		assert.equal(repairedManifest.entries.length, 1);

		const archive = path.join(root, 'Thingtime.zip');
		const result = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', sourceApp, archive], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
		let verificationCount = 0;
		await assert.rejects(
			cacheReleaseArchive({
				archivePath: archive,
				cacheRoot,
				release: { asset: { name: 'Thingtime.zip' }, id: 'broken-release', tag: 'electron-v0.1.2', version: '0.1.2' },
				verifyApp: async () => {
					verificationCount += 1;
					if (verificationCount === 2) throw new Error('injected verification failure');
				}
			}),
			/injected verification failure/u
		);
		assert.deepEqual(await readdir(path.join(cacheRoot, 'bundles')), [cached.key]);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('cached bundle discovery rejects a symbolic-link bundle directory even when its final app directory looks regular', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'thingtime-release-cache-'));
	try {
		const cacheRoot = path.join(root, 'cache');
		const key = 'outside-abcdef123456';
		const outside = path.join(root, 'outside');
		await mkdir(path.join(outside, 'Thingtime.app'), { recursive: true });
		await mkdir(path.join(cacheRoot, 'bundles'), { recursive: true });
		await symlink(outside, path.join(cacheRoot, 'bundles', key));
		await writeFile(path.join(cacheRoot, 'manifest.json'), `${JSON.stringify({ format: 1, entries: [{ key, tag: 'tampered' }] })}\n`);
		assert.equal(getCachedBundles(cacheRoot).length, 0);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
