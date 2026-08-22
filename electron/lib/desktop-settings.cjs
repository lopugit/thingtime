'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const SETTINGS_SCHEMA_VERSION = 3;
const READABLE_SETTINGS_SCHEMA_VERSIONS = new Set([1, 2, SETTINGS_SCHEMA_VERSION]);
const MAX_CUSTOM_ENDPOINTS = 32;
const MAX_LABEL_BYTES = 120;
const MAX_SETTINGS_BYTES = 64 * 1024;
const DEFAULT_ENDPOINTS = Object.freeze([
	Object.freeze({ id: 'production', label: 'Production', url: 'https://thingtime.com/', source: 'built-in' }),
	Object.freeze({ id: 'development', label: 'Development', url: 'https://dev.thingtime.com/', source: 'built-in' })
]);
const MENU_BAR_ICONS = Object.freeze([
	Object.freeze({ id: 'tree-color', label: 'Tree · Colour' }),
	Object.freeze({ id: 'tree-template', label: 'Tree · Automatic black/white' }),
	Object.freeze({ id: 'tree-black', label: 'Tree · Black' }),
	Object.freeze({ id: 'tree-white', label: 'Tree · White' }),
	Object.freeze({ id: 'tree-pink', label: 'Four squares · Pink' }),
	Object.freeze({ id: 'tree-blue', label: 'Four squares · Blue' }),
	Object.freeze({ id: 'wordmark-color', label: 'Full pixel logo · Colour' }),
	Object.freeze({ id: 'wordmark-template', label: 'Full pixel logo · Automatic black/white' }),
	Object.freeze({ id: 'wordmark-black', label: 'Full pixel logo · Black' }),
	Object.freeze({ id: 'wordmark-white', label: 'Full pixel logo · White' }),
	Object.freeze({ id: 'custom', label: 'Custom image', custom: true })
]);
const MENU_BAR_ICON_IDS = new Set(MENU_BAR_ICONS.map((entry) => entry.id));
const DEFAULT_MENU_BAR_ICON_ID = 'tree-pink';

function byteLength(value) {
	return Buffer.byteLength(value, 'utf8');
}

function normalizedLabel(rawLabel) {
	const label = String(rawLabel || '')
		.replace(/[\p{Cc}\p{Cf}]/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim();
	if (!label || byteLength(label) > MAX_LABEL_BYTES) throw new Error(`Endpoint labels must contain 1 to ${MAX_LABEL_BYTES} UTF-8 bytes.`);
	return label;
}

function isLoopbackHostname(hostname) {
	const normalized = String(hostname || '')
		.toLowerCase()
		.replace(/^\[|\]$/gu, '');
	if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
	const address = net.isIP(normalized) ? normalized : null;
	return address === '127.0.0.1' || address === '::1';
}

function normalizeEndpointUrl(rawUrl) {
	let url;
	try {
		url = new URL(String(rawUrl || '').trim());
	} catch {
		throw new Error('Enter a valid Thingtime endpoint URL.');
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new Error('Thingtime endpoint URLs cannot contain credentials, query parameters, or fragments.');
	}
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
		throw new Error('Thingtime endpoints must use HTTPS, except for local loopback development.');
	}
	if (url.pathname !== '/' && url.pathname !== '') {
		throw new Error('Thingtime endpoint URLs must use the deployment origin without an extra path.');
	}
	url.pathname = '/';
	return url.href;
}

function customEndpointId(url) {
	return `custom-${crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)}`;
}

function normalizeBuildEndpointConfiguration(metadata = {}) {
	const raw = metadata?.desktopEndpoints;
	const options = [];
	for (const entry of Array.isArray(raw?.options) ? raw.options : []) {
		try {
			const id = String(entry?.id || '').trim();
			if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(id)) continue;
			options.push({
				id,
				label: normalizedLabel(entry.label),
				source: 'build',
				url: normalizeEndpointUrl(entry.url)
			});
		} catch {
			// Build metadata is untrusted input. Ignore malformed entries instead of
			// making the installed app unable to start.
		}
	}
	const defaultId = typeof raw?.defaultId === 'string' ? raw.defaultId : null;
	return { defaultId, options };
}

function mergeEndpointProfiles(metadata, customEndpoints = []) {
	const build = normalizeBuildEndpointConfiguration(metadata);
	const byUrl = new Map();
	for (const endpoint of [...build.options, ...DEFAULT_ENDPOINTS]) {
		if (!byUrl.has(endpoint.url)) byUrl.set(endpoint.url, endpoint);
	}
	for (const endpoint of customEndpoints) {
		if (!byUrl.has(endpoint.url)) byUrl.set(endpoint.url, endpoint);
	}
	return { build, profiles: [...byUrl.values()] };
}

function emptyPersistedState() {
	return {
		autoStartNodeOnLaunch: true,
		customEndpoints: [],
		customMenuBarIconPath: null,
		menuBarIconId: DEFAULT_MENU_BAR_ICON_ID,
		schemaVersion: SETTINGS_SCHEMA_VERSION,
		selectedEndpointId: null,
		selectedEndpointLabel: null,
		selectedEndpointUrl: null
	};
}

function normalizePersistedState(value) {
	const state = emptyPersistedState();
	if (!value || typeof value !== 'object' || Array.isArray(value) || !READABLE_SETTINGS_SCHEMA_VERSIONS.has(value.schemaVersion)) return state;
	for (const entry of Array.isArray(value.customEndpoints) ? value.customEndpoints.slice(0, MAX_CUSTOM_ENDPOINTS) : []) {
		try {
			const url = normalizeEndpointUrl(entry?.url);
			state.customEndpoints.push({ id: customEndpointId(url), label: normalizedLabel(entry?.label), source: 'custom', url });
		} catch {
			// Invalid local entries are dropped rather than trusted after upgrades.
		}
	}
	state.customEndpoints = [...new Map(state.customEndpoints.map((entry) => [entry.url, entry])).values()];
	state.autoStartNodeOnLaunch = typeof value.autoStartNodeOnLaunch === 'boolean' ? value.autoStartNodeOnLaunch : true;
	state.selectedEndpointId = typeof value.selectedEndpointId === 'string' ? value.selectedEndpointId : null;
	if (typeof value.selectedEndpointLabel === 'string') {
		try {
			state.selectedEndpointLabel = normalizedLabel(value.selectedEndpointLabel);
		} catch {
			state.selectedEndpointLabel = null;
		}
	}
	if (typeof value.selectedEndpointUrl === 'string') {
		try {
			state.selectedEndpointUrl = normalizeEndpointUrl(value.selectedEndpointUrl);
		} catch {
			state.selectedEndpointUrl = null;
		}
	}
	state.menuBarIconId = MENU_BAR_ICON_IDS.has(value.menuBarIconId) ? value.menuBarIconId : DEFAULT_MENU_BAR_ICON_ID;
	if (
		typeof value.customMenuBarIconPath === 'string' &&
		path.isAbsolute(value.customMenuBarIconPath) &&
		!/[\0\r\n]/u.test(value.customMenuBarIconPath)
	) {
		state.customMenuBarIconPath = value.customMenuBarIconPath;
	}
	return state;
}

async function writeFileAtomically(filePath, contents) {
	const directory = path.dirname(filePath);
	const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
	await fsPromises.mkdir(directory, { mode: 0o700, recursive: true });
	try {
		await fsPromises.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
		await fsPromises.rename(temporaryPath, filePath);
		await fsPromises.chmod(filePath, 0o600);
	} finally {
		await fsPromises.rm(temporaryPath, { force: true });
	}
}

class DesktopSettingsStore {
	constructor({ filePath, metadata = {} }) {
		if (!path.isAbsolute(filePath)) throw new Error('Desktop settings path must be absolute.');
		this.filePath = filePath;
		this.metadata = metadata;
		this.state = emptyPersistedState();
		this.ready = false;
		this.pending = Promise.resolve();
	}

	async initialize() {
		if (this.ready) return this.snapshot();
		let parsed = null;
		try {
			const stat = await fsPromises.lstat(this.filePath);
			if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_SETTINGS_BYTES) throw new Error('Desktop settings file is invalid.');
			try {
				parsed = JSON.parse(await fsPromises.readFile(this.filePath, 'utf8'));
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				parsed = null;
			}
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		this.state = normalizePersistedState(parsed);
		this.ready = true;
		this.rememberSelectedEndpoint(this.resolved().selected);
		await this.persist();
		return this.snapshot();
	}

	assertReady() {
		if (!this.ready) throw new Error('Desktop settings are not initialized.');
	}

	resolved() {
		this.assertReady();
		const { build, profiles: configuredProfiles } = mergeEndpointProfiles(this.metadata, this.state.customEndpoints);
		const profiles = [...configuredProfiles];
		if (this.state.selectedEndpointUrl && !profiles.some((entry) => entry.url === this.state.selectedEndpointUrl)) {
			profiles.push({
				id: customEndpointId(this.state.selectedEndpointUrl),
				label: this.state.selectedEndpointLabel || new URL(this.state.selectedEndpointUrl).host,
				source: 'custom',
				url: this.state.selectedEndpointUrl
			});
		}
		const selected =
			profiles.find((entry) => entry.url === this.state.selectedEndpointUrl) ||
			profiles.find((entry) => entry.id === this.state.selectedEndpointId) ||
			profiles.find((entry) => entry.id === build.defaultId) ||
			profiles[0] ||
			DEFAULT_ENDPOINTS[0];
		return { build, profiles, selected };
	}

	rememberSelectedEndpoint(endpoint) {
		this.state.selectedEndpointId = endpoint.id;
		this.state.selectedEndpointLabel = normalizedLabel(endpoint.label);
		this.state.selectedEndpointUrl = endpoint.url;
	}

	snapshot() {
		const { profiles, selected } = this.resolved();
		return {
			autoStartNodeOnLaunch: this.state.autoStartNodeOnLaunch,
			customMenuBarIconConfigured: Boolean(this.state.customMenuBarIconPath && fs.existsSync(this.state.customMenuBarIconPath)),
			endpointProfiles: profiles.map(({ id, label, source, url }) => ({ id, label, source, url })),
			menuBarIcons: MENU_BAR_ICONS,
			selectedEndpoint: { id: selected.id, label: selected.label, source: selected.source, url: selected.url },
			selectedEndpointId: selected.id,
			selectedMenuBarIconId:
				this.state.menuBarIconId === 'custom' && !this.state.customMenuBarIconPath ? DEFAULT_MENU_BAR_ICON_ID : this.state.menuBarIconId
		};
	}

	nodeRegistration() {
		const snapshot = this.snapshot();
		return {
			apiBaseUrl: snapshot.selectedEndpoint.url,
			menuBarCustomIconPath: snapshot.selectedMenuBarIconId === 'custom' ? this.state.customMenuBarIconPath : null,
			menuBarIconId: snapshot.selectedMenuBarIconId
		};
	}

	async persist() {
		const encoded = `${JSON.stringify(this.state, null, 2)}\n`;
		if (byteLength(encoded) > MAX_SETTINGS_BYTES) throw new Error('Desktop settings exceed the local storage limit.');
		await writeFileAtomically(this.filePath, encoded);
	}

	enqueue(operation) {
		const next = this.pending.then(operation, operation);
		this.pending = next.catch(() => {});
		return next;
	}

	async selectEndpoint(endpointId) {
		return this.enqueue(async () => {
			const normalizedId = String(endpointId || '').trim();
			const { profiles } = this.resolved();
			const selected = profiles.find((entry) => entry.id === normalizedId);
			if (!selected) throw new Error('Choose a known Thingtime endpoint.');
			this.rememberSelectedEndpoint(selected);
			await this.persist();
			return this.snapshot();
		});
	}

	async addEndpoint({ label, url }) {
		return this.enqueue(async () => {
			const normalizedUrl = normalizeEndpointUrl(url);
			const normalizedName = normalizedLabel(label);
			const { profiles } = this.resolved();
			const builtIn = profiles.find((entry) => entry.source !== 'custom' && entry.url === normalizedUrl);
			if (builtIn) return this.snapshot();
			const existing = this.state.customEndpoints.find((entry) => entry.url === normalizedUrl);
			if (existing) existing.label = normalizedName;
			else {
				if (this.state.customEndpoints.length >= MAX_CUSTOM_ENDPOINTS)
					throw new Error(`You can save up to ${MAX_CUSTOM_ENDPOINTS} custom endpoints.`);
				this.state.customEndpoints.push({ id: customEndpointId(normalizedUrl), label: normalizedName, source: 'custom', url: normalizedUrl });
			}
			await this.persist();
			return this.snapshot();
		});
	}

	async removeEndpoint(endpointId) {
		return this.enqueue(async () => {
			const normalizedId = String(endpointId || '').trim();
			const { selected } = this.resolved();
			if (selected.id === normalizedId) throw new Error('Switch to another endpoint before removing this one.');
			const before = this.state.customEndpoints.length;
			this.state.customEndpoints = this.state.customEndpoints.filter((entry) => entry.id !== normalizedId);
			if (before === this.state.customEndpoints.length) throw new Error('Only custom endpoints can be removed.');
			await this.persist();
			return this.snapshot();
		});
	}

	async selectMenuBarIcon(iconId, customIconPath) {
		return this.enqueue(async () => {
			const normalizedId = String(iconId || '').trim();
			if (!MENU_BAR_ICON_IDS.has(normalizedId)) throw new Error('Choose a known Thingtime menu bar icon.');
			if (customIconPath !== undefined) {
				if (typeof customIconPath !== 'string' || !path.isAbsolute(customIconPath) || /[\0\r\n]/u.test(customIconPath)) {
					throw new Error('The custom menu bar icon path is invalid.');
				}
				this.state.customMenuBarIconPath = customIconPath;
			}
			if (normalizedId === 'custom' && !this.state.customMenuBarIconPath) throw new Error('Choose a custom image before selecting the custom icon.');
			this.state.menuBarIconId = normalizedId;
			await this.persist();
			return this.snapshot();
		});
	}

	async setAutoStartNodeOnLaunch(enabled) {
		return this.enqueue(async () => {
			if (typeof enabled !== 'boolean') throw new Error('Choose whether Thingtime should start its managed node when the app launches.');
			this.state.autoStartNodeOnLaunch = enabled;
			await this.persist();
			return this.snapshot();
		});
	}
}

module.exports = {
	DEFAULT_MENU_BAR_ICON_ID,
	DesktopSettingsStore,
	MAX_CUSTOM_ENDPOINTS,
	MENU_BAR_ICONS,
	customEndpointId,
	mergeEndpointProfiles,
	normalizeBuildEndpointConfiguration,
	normalizeEndpointUrl,
	normalizePersistedState
};
