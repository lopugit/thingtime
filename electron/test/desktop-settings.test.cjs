'use strict';

const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { DesktopSettingsStore, customEndpointId, normalizeEndpointUrl, normalizePersistedState } = require('../lib/desktop-settings.cjs');

test('endpoint URLs are deployment origins with HTTPS or loopback HTTP only', () => {
	assert.equal(normalizeEndpointUrl('https://pr-68.previews.dev.thingtime.com'), 'https://pr-68.previews.dev.thingtime.com/');
	assert.equal(normalizeEndpointUrl('http://127.0.0.1:9999/'), 'http://127.0.0.1:9999/');
	assert.equal(normalizeEndpointUrl('http://[::1]:9999/'), 'http://[::1]:9999/');
	assert.throws(() => normalizeEndpointUrl('http://example.com/'), /HTTPS/u);
	assert.throws(() => normalizeEndpointUrl('https://user:secret@example.com/'), /credentials/u);
	assert.throws(() => normalizeEndpointUrl('https://example.com/subpath'), /origin/u);
	assert.throws(() => normalizeEndpointUrl('file:///tmp/app'), /HTTPS/u);
});

test('local endpoint profiles persist atomically and preserve multiple custom deployments', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	const metadata = {
		desktopEndpoints: {
			defaultId: 'pr-68',
			options: [{ id: 'pr-68', label: 'PR #68 preview', url: 'https://pr-68.previews.dev.thingtime.com/' }]
		}
	};
	try {
		const store = new DesktopSettingsStore({ filePath, metadata });
		let snapshot = await store.initialize();
		assert.equal(snapshot.selectedEndpointId, 'pr-68');
		assert.equal(snapshot.selectedMenuBarIconId, 'tree-pink');
		assert.equal(snapshot.autoStartNodeOnLaunch, true);
		assert.deepEqual(
			snapshot.endpointProfiles.map((entry) => entry.id),
			['pr-68', 'production', 'development']
		);

		await store.addEndpoint({ label: 'Local one', url: 'http://localhost:9999/' });
		await store.addEndpoint({ label: 'Local two', url: 'http://127.0.0.1:12000/' });
		snapshot = await store.selectEndpoint(customEndpointId('http://localhost:9999/'));
		assert.equal(snapshot.selectedEndpoint.url, 'http://localhost:9999/');
		assert.equal(snapshot.endpointProfiles.filter((entry) => entry.source === 'custom').length, 2);
		assert.equal((await stat(filePath)).mode & 0o777, 0o600);

		const reopened = new DesktopSettingsStore({ filePath, metadata });
		assert.equal((await reopened.initialize()).selectedEndpoint.url, 'http://localhost:9999/');
		assert.match(await readFile(filePath, 'utf8'), /Local two/u);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('selected build endpoints remain selected when later builds omit or rename their profile', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	const previewUrl = 'https://pr-68.previews.dev.thingtime.com/';
	try {
		const previewBuild = new DesktopSettingsStore({
			filePath,
			metadata: {
				desktopEndpoints: {
					defaultId: 'pr-68',
					options: [{ id: 'pr-68', label: 'PR #68 preview', url: previewUrl }]
				}
			}
		});
		assert.equal((await previewBuild.initialize()).selectedEndpoint.url, previewUrl);
		const persisted = JSON.parse(await readFile(filePath, 'utf8'));
		assert.equal(persisted.schemaVersion, 3);
		assert.equal(persisted.selectedEndpointUrl, previewUrl);
		assert.equal(persisted.selectedEndpointLabel, 'PR #68 preview');
		assert.deepEqual(persisted.customEndpoints, []);

		const productionBuild = new DesktopSettingsStore({ filePath });
		let snapshot = await productionBuild.initialize();
		assert.equal(snapshot.selectedEndpoint.url, previewUrl);
		assert.equal(snapshot.selectedEndpointId, customEndpointId(previewUrl));

		const renamedBuild = new DesktopSettingsStore({
			filePath,
			metadata: {
				desktopEndpoints: {
					defaultId: 'preview-renamed',
					options: [{ id: 'preview-renamed', label: 'Renamed preview', url: previewUrl }]
				}
			}
		});
		snapshot = await renamedBuild.initialize();
		assert.equal(snapshot.selectedEndpoint.url, previewUrl);
		assert.equal(snapshot.selectedEndpointId, 'preview-renamed');
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('schema-one endpoint ids migrate to URL-stable selections while their build metadata is available', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	const previewUrl = 'https://preview.example.com/';
	try {
		await writeFile(
			filePath,
			JSON.stringify({
				customEndpoints: [],
				customMenuBarIconPath: null,
				menuBarIconId: 'tree-pink',
				schemaVersion: 1,
				selectedEndpointId: 'legacy-preview'
			}),
			{ mode: 0o600 }
		);
		const migrated = new DesktopSettingsStore({
			filePath,
			metadata: {
				desktopEndpoints: {
					defaultId: 'production',
					options: [{ id: 'legacy-preview', label: 'Legacy preview', url: previewUrl }]
				}
			}
		});
		assert.equal((await migrated.initialize()).selectedEndpoint.url, previewUrl);
		const persisted = JSON.parse(await readFile(filePath, 'utf8'));
		assert.equal(persisted.schemaVersion, 3);
		assert.equal(persisted.selectedEndpointUrl, previewUrl);

		const reopened = new DesktopSettingsStore({ filePath });
		assert.equal((await reopened.initialize()).selectedEndpoint.url, previewUrl);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('custom endpoint removal is limited to inactive custom entries', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	try {
		const store = new DesktopSettingsStore({ filePath });
		await store.initialize();
		await store.addEndpoint({ label: 'Preview', url: 'https://preview.example.com/' });
		const customId = customEndpointId('https://preview.example.com/');
		await store.selectEndpoint(customId);
		await assert.rejects(store.removeEndpoint(customId), /Switch/u);
		await store.selectEndpoint('production');
		const snapshot = await store.removeEndpoint(customId);
		assert.equal(
			snapshot.endpointProfiles.some((entry) => entry.id === customId),
			false
		);
		await store.selectEndpoint('development');
		await assert.rejects(store.removeEndpoint('production'), /Only custom/u);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('menu icon choices persist without exposing the custom local file path', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	const customIconPath = path.join(root, 'menu-icon.png');
	try {
		await writeFile(customIconPath, 'image fixture');
		const store = new DesktopSettingsStore({ filePath });
		await store.initialize();
		let snapshot = await store.selectMenuBarIcon('custom', customIconPath);
		assert.equal(snapshot.selectedMenuBarIconId, 'custom');
		assert.equal(snapshot.customMenuBarIconConfigured, true);
		assert.equal(JSON.stringify(snapshot).includes(customIconPath), false);
		assert.equal(store.nodeRegistration().menuBarCustomIconPath, customIconPath);
		snapshot = await store.selectMenuBarIcon('wordmark-white');
		assert.equal(snapshot.selectedMenuBarIconId, 'wordmark-white');
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('managed node launch preference defaults on, persists off, and migrates older settings safely', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	try {
		const store = new DesktopSettingsStore({ filePath });
		assert.equal((await store.initialize()).autoStartNodeOnLaunch, true);
		await assert.rejects(store.setAutoStartNodeOnLaunch('yes'), /Choose whether/u);
		assert.equal((await store.setAutoStartNodeOnLaunch(false)).autoStartNodeOnLaunch, false);
		assert.equal((await new DesktopSettingsStore({ filePath }).initialize()).autoStartNodeOnLaunch, false);

		await writeFile(
			filePath,
			JSON.stringify({
				customEndpoints: [],
				customMenuBarIconPath: null,
				menuBarIconId: 'tree-pink',
				schemaVersion: 2,
				selectedEndpointId: 'production'
			}),
			{ mode: 0o600 }
		);
		assert.equal((await new DesktopSettingsStore({ filePath }).initialize()).autoStartNodeOnLaunch, true);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('malformed persisted settings fail closed to bounded defaults', () => {
	const state = normalizePersistedState({
		customEndpoints: [
			{ label: 'Bad', url: 'http://remote.example.com/' },
			{ label: 'Good', url: 'https://custom.example.com/' },
			{ label: 'Duplicate', url: 'https://custom.example.com/' }
		],
		customMenuBarIconPath: 'relative.png',
		menuBarIconId: 'unknown',
		schemaVersion: 1,
		selectedEndpointId: 'missing'
	});
	assert.equal(state.customEndpoints.length, 1);
	assert.equal(state.autoStartNodeOnLaunch, true);
	assert.equal(state.customMenuBarIconPath, null);
	assert.equal(state.menuBarIconId, 'tree-pink');
	assert.equal(state.selectedEndpointId, 'missing');
	assert.equal(state.selectedEndpointLabel, null);
	assert.equal(state.selectedEndpointUrl, null);
});

test('invalid local JSON is repaired to safe defaults instead of blocking app startup', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'thingtime-desktop-settings-'));
	const filePath = path.join(root, 'desktop-settings.json');
	try {
		await writeFile(filePath, '{not-json', { mode: 0o600 });
		const store = new DesktopSettingsStore({ filePath });
		const snapshot = await store.initialize();
		assert.equal(snapshot.selectedEndpointId, 'production');
		assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).customEndpoints, []);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
