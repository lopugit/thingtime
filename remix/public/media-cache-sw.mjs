import { mediaStore, cacheEnabled, MAX_AGE, MAX_FILE_BYTES } from './media-cache-store.mjs';
import { boundedBlob, compatibleManifest, managedUrl, publicAsset, publicLifetime, responseFromRecord } from './media-cache-core.mjs';

const origin = self.location.origin;
const inflight = new Map();
let enabled = true;
const storageDeadline = (work, fallback) => {
	let timer;
	return Promise.race([
		work,
		new Promise((resolve) => {
			timer = setTimeout(() => resolve(fallback), 2500);
		})
	]).finally(() => clearTimeout(timer));
};
const preferencesReady = storageDeadline(cacheEnabled(), false).then((value) => {
	enabled = value;
});
let generation = 0;
let capability;
// A cache worker never intercepts HTML, JS bundles or general API responses.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function supportsCaching() {
	if (!capability || capability.expires < Date.now()) {
		capability = {
			expires: Date.now() + 60_000,
			promise: fetch('/.well-known/thingtime-capabilities.json', {
				cache: 'no-store',
				signal: AbortSignal.timeout(5000)
			})
				.then(async (response) => response.ok && compatibleManifest(await response.json(), origin))
				.catch(() => false)
		};
	}
	return capability.promise;
}
async function save(key, response, lifetime, epoch) {
	const bytes = await boundedBlob(response);
	if (!bytes || epoch !== generation || !enabled) return;
	// Never retain Location, cookies, signed URLs, or cross-origin response metadata.
	const headers = {};
	for (const name of ['Content-Type', 'Content-Disposition', 'X-Content-Type-Options']) {
		if (response.headers.has(name)) headers[name] = response.headers.get(name);
	}
	await mediaStore.put({ key, bytes, headers, usedAt: Date.now(), expiresAt: Date.now() + lifetime });
}
async function handle(request, event) {
	await preferencesReady;
	if (!enabled) return fetch(request);
	const epoch = generation;
	const managed = managedUrl(request, origin);
	let key, lifetime;
	if (managed) {
		if (!(await supportsCaching())) return fetch(request);
		const validation = new URL(managed);
		validation.searchParams.set('cache', 'validate');
		let response;
		try {
			response = await fetch(validation, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
		} catch {
			return new Response(null, { status: 503 });
		}
		// Fail closed, including offline, revoked, deleted and moderation-blocked media.
		if (!response.ok) return response;
		let receipt;
		try {
			receipt = await response.json();
		} catch {
			return fetch(request);
		}
		if (!receipt.ok || !/^[a-f0-9]{64}:(original|64|320|640|1280|1920)$/.test(receipt.cacheKey)) return fetch(request);
		key = `managed:${receipt.cacheKey}`;
		lifetime = MAX_AGE;
		if (!managed.searchParams.has('width') && receipt.size > MAX_FILE_BYTES) return fetch(request);
	} else {
		key = `public:${request.url}`;
	}
	if (epoch !== generation || !enabled) return fetch(request);
	const cached = await storageDeadline(mediaStore.get(key), null);
	if (cached && epoch === generation && enabled) {
		const response = responseFromRecord(cached, request.headers.get('Range'));
		if (response) {
			event.waitUntil(mediaStore.put({ ...cached, usedAt: Date.now() }));
			return response;
		}
	}
	// Do not predownload a full movie to satisfy its first metadata/range request.
	if (request.headers.has('Range')) return fetch(request);
	let work = inflight.get(key);
	if (!work) {
		work = (async () => {
			let response;
			if (managed) {
				// Same-origin bounded bytes avoid requiring S3 GET CORS or duplicating opaque downloads.
				const bytesUrl = new URL(managed);
				if (!bytesUrl.searchParams.has('width')) bytesUrl.searchParams.set('cache', 'bytes');
				response = await fetch(bytesUrl, { credentials: 'same-origin', signal: AbortSignal.timeout(30_000) });
			} else response = await fetch(request);
			const ttl = managed ? lifetime : publicLifetime(response);
			if (ttl && response.status === 200) event.waitUntil(save(key, response.clone(), ttl, epoch));
			return response;
		})().finally(() => inflight.delete(key));
		inflight.set(key, work);
	}
	return (await work).clone();
}
self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (managedUrl(request, origin) || publicAsset(request, origin)) {
		event.respondWith(handle(request, event).catch(() => fetch(request)));
	}
});
self.addEventListener('message', (event) => {
	// Only same-origin controlled pages can change this browser's cache preferences.
	if (!event.source?.url || new URL(event.source.url).origin !== origin) return;
	const type = event.data?.type;
	if (!['tt-media-status', 'tt-media-clear', 'tt-media-config'].includes(type)) return;
	event.waitUntil(
		(async () => {
			await preferencesReady;
			if (type === 'tt-media-config') {
				enabled = event.data.enabled !== false;
				await cacheEnabled(enabled);
			}
			if (type === 'tt-media-clear' || (type === 'tt-media-config' && !enabled)) {
				generation++;
				await mediaStore.clear();
			}
			event.ports[0]?.postMessage({ ...(await mediaStore.status()), enabled });
		})()
	);
});
