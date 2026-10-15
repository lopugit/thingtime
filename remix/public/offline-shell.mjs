import { offlineShellManifest } from './offline-shell-manifest.mjs';

export const OFFLINE_SHELL_MAX_BYTES = 96 * 1024 * 1024;
const PREFIX = 'thingtime:offline-shell:v1:';
const COMPLETE = '/__thingtime_offline_shell_complete__';
export function validateOfflineManifest(manifest) {
	if (!manifest || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.hash) || !Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 2500) return false;
	let total = 0; const seen = new Set();
	for (const asset of manifest.assets) {
		if (!asset || typeof asset.path !== 'string' || !/^\/(?:assets\/[\w.-]+\.(?:js|css|woff2?)|tt-boot\.js|offline-shell\.html)$/.test(asset.path) ||
			seen.has(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1) return false;
		seen.add(asset.path); total += asset.bytes;
	}
	return total <= OFFLINE_SHELL_MAX_BYTES && seen.has('/offline-shell.html');
}
export function offlineShellRequest(request, origin, manifest = offlineShellManifest) {
	if (!validateOfflineManifest(manifest) || request.method !== 'GET') return false;
	const url = new URL(request.url);
	if (url.origin !== origin || url.search || request.headers.has('Range')) {
		// Navigation query parameters stay in the address bar, never in a cache key.
		if (request.mode !== 'navigate' || url.origin !== origin || request.headers.has('Range')) return false;
	}
	if (request.mode === 'navigate') return !/^\/(?:api(?:\/|$)|\.well-known(?:\/|$)|draft-preview(?:\/|$)|platform(?:\/|$)|library(?:\/|$))/.test(url.pathname);
	return manifest.assets.some(asset => asset.path === url.pathname) || /^\/assets\/[\w.-]+\.(?:js|css|woff2?)$/.test(url.pathname);
}
const cacheName = (manifest = offlineShellManifest) => PREFIX + manifest.hash;
const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
let installing;
export function installOfflineShell() {
	if (!validateOfflineManifest(offlineShellManifest)) return Promise.resolve();
	return installing ??= prepareOfflineShell(offlineShellManifest, caches, fetch);
}
export async function prepareOfflineShell(manifest, cacheStorage, fetcher) {
	if (!validateOfflineManifest(manifest)) throw new Error('Invalid offline shell manifest');
	const cache = await cacheStorage.open(cacheName(manifest));
	if (await cache.match(COMPLETE)) return;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 90_000);
	try {
		let next = 0;
		const results = await Promise.allSettled(Array.from({ length: 4 }, async () => {
			try {
				for (; next < manifest.assets.length;) {
					controller.signal.throwIfAborted();
					const asset = manifest.assets[next++];
					const response = await fetcher(asset.path, { credentials: 'omit', redirect: 'error', cache: 'reload', signal: controller.signal });
					if (!response.ok) throw new Error('Offline shell download failed');
					const reader = response.body?.getReader(); if (!reader) throw new Error('Offline asset has no body');
					const chunks = []; let size = 0;
					try {
						for (;;) {
							const { done, value } = await reader.read(); if (done) break;
							size += value.byteLength; if (size > asset.bytes) throw new Error('Offline asset size changed'); chunks.push(value);
						}
					} finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
					const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
					if (size !== asset.bytes || await digest(bytes) !== asset.sha256) throw new Error('Offline asset checksum changed');
					controller.signal.throwIfAborted();
					const headers = new Headers();
					for (const name of ['Content-Type', 'Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy']) if (response.headers.has(name)) headers.set(name, response.headers.get(name));
					await cache.put(asset.path, new Response(bytes, { headers }));
				}
			} catch (error) { controller.abort(); throw error; }
		}));
		const failure = results.find(result => result.status === 'rejected');
		if (failure) throw failure.reason;
		await cache.put(COMPLETE, new Response(String(Date.now())));
	} catch (error) { await cacheStorage.delete(cacheName(manifest)); throw error; }
	finally { clearTimeout(timer); }
}
export async function pruneOfflineShells() {
	if (!validateOfflineManifest(offlineShellManifest)) return;
	const current = cacheName(); const cache = await caches.open(current);
	if (!await cache.match(COMPLETE)) return;
	const completed = [];
	for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== current) {
		const previous = await caches.open(name); const marker = await previous.match(COMPLETE);
		if (marker) completed.push({ name, time: Number(await marker.text()) || 0 });
		else await caches.delete(name);
	}
	completed.sort((a, b) => b.time - a.time);
	for (const previous of completed.slice(1)) await caches.delete(previous.name);
}
export async function handleOfflineShell(request) {
	const url = new URL(request.url);
	if (request.mode === 'navigate') {
		try { return await fetch(request); }
		catch (error) {
			const cache = await caches.open(cacheName());
			if (await cache.match(COMPLETE)) { const shell = await cache.match('/offline-shell.html'); if (shell) return shell; }
			throw error;
		}
	}
	// Immutable URLs can be served from either the active build or the previous
	// complete build while an already-open editor finishes its work.
	for (const name of [cacheName(), ...(await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== cacheName())]) {
		const cache = await caches.open(name);
		if (await cache.match(COMPLETE)) { const cached = await cache.match(url.pathname); if (cached) return cached; }
	}
	return fetch(request);
}
