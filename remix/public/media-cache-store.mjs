// Binary storage only; never localStorage/base64. Each backend is bounded.
export const MAX_BYTES = 128 * 1024 * 1024;
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_ENTRIES = 256;
export const MAX_AGE = 7 * 86400000;
const DB = 'thingtime-media-v1';
const memory = new Map();
let database;
let backend;
let serial = Promise.resolve();
const bounded = (work) => {
	let timer;
	return Promise.race([
		work,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error('Storage timeout')), 2000);
		})
	]).finally(() => clearTimeout(timer));
};

function openDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB, 2);
		let expired = false;
		const timer = setTimeout(() => {
			expired = true;
			reject(new Error('Storage timeout'));
		}, 1500);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains('media')) request.result.createObjectStore('media', { keyPath: 'key' });
			if (!request.result.objectStoreNames.contains('preferences')) request.result.createObjectStore('preferences');
		};
		request.onsuccess = () => {
			clearTimeout(timer);
			if (expired) request.result.close();
			else resolve(request.result);
		};
		request.onerror = request.onblocked = () => {
			clearTimeout(timer);
			reject(new Error('Storage unavailable'));
		};
	});
}
async function idb(mode, operation, storeName = 'media') {
	database ||= await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(storeName, mode);
		const request = operation(transaction.objectStore(storeName));
		const timer = setTimeout(() => {
			try {
				transaction.abort();
			} catch {}
			reject(new Error('Storage timeout'));
		}, 2000);
		transaction.oncomplete = () => {
			clearTimeout(timer);
			resolve(request.result);
		};
		transaction.onerror = transaction.onabort = () => {
			clearTimeout(timer);
			reject(new Error('Storage unavailable'));
		};
	});
}
const cacheUrl = (key) => new URL(`/__tt_media_cache__/${encodeURIComponent(key)}`, self.location.origin).href;
async function operate(name, value) {
	// Once a backend fails, degrade for this worker lifetime; the network remains usable.
	if (!backend || backend === 'IndexedDB') {
		try {
			const result = await idb(name === 'getAll' || name === 'get' ? 'readonly' : 'readwrite', (store) => store[name](value));
			backend = 'IndexedDB';
			return result;
		} catch {
			backend = 'Cache Storage';
		}
	}
	if (backend === 'Cache Storage') {
		try {
			const cache = await bounded(caches.open(DB));
			const decode = async (response) =>
				response ? { ...JSON.parse(response.headers.get('x-tt-record')), bytes: await response.blob() } : undefined;
			if (name === 'get') return bounded(decode(await bounded(cache.match(cacheUrl(value)))));
			if (name === 'getAll') return bounded(Promise.all((await bounded(cache.keys())).map(async (key) => decode(await cache.match(key)))));
			if (name === 'clear') {
				await bounded(caches.delete(DB));
				return;
			}
			if (name === 'delete') {
				await bounded(cache.delete(cacheUrl(value)));
				return;
			}
			const { bytes, ...metadata } = value;
			await bounded(cache.put(cacheUrl(value.key), new Response(bytes, { headers: { 'x-tt-record': JSON.stringify(metadata) } })));
			return;
		} catch {
			backend = 'Memory';
		}
	}
	if (name === 'get') return memory.get(value);
	if (name === 'getAll') return [...memory.values()];
	if (name === 'clear') return memory.clear();
	if (name === 'delete') return memory.delete(value);
	memory.set(value.key, value);
}
export const mediaStore = {
	async get(key) {
		await serial;
		const record = await operate('get', key);
		if (!record || !(record.bytes instanceof Blob) || Date.now() >= record.expiresAt) return null;
		return record;
	},
	put(record) {
		const operation = serial.then(async () => {
			if (!record.bytes.size || record.bytes.size > MAX_FILE_BYTES) return;
			const records = (await operate('getAll')).sort((a, b) => a.usedAt - b.usedAt);
			let total = records.reduce((sum, item) => sum + item.bytes.size, 0);
			let count = records.length;
			for (const item of records) {
				if (item.key === record.key || item.expiresAt <= Date.now() || total + record.bytes.size > MAX_BYTES || count >= MAX_ENTRIES) {
					await operate('delete', item.key);
					total -= item.bytes.size;
					count--;
				}
			}
			await operate('put', record);
		});
		serial = operation.catch(() => {});
		return serial;
	},
	clear() {
		const operation = serial.then(async () => {
			// Clear all tiers, including a persistent tier that failed earlier.
			memory.clear();
			try {
				await idb('readwrite', (store) => store.clear());
			} catch {
				/* unavailable */
			}
			try {
				await bounded(caches.delete(DB));
			} catch {
				/* unavailable */
			}
		});
		serial = operation.catch(() => {});
		return serial;
	},
	async status() {
		await serial;
		const records = await operate('getAll');
		return { backend: backend || 'Memory', bytes: records.reduce((sum, item) => sum + item.bytes.size, 0), entries: records.length };
	}
};

export async function cacheEnabled(value) {
	try {
		if (typeof value === 'boolean') await idb('readwrite', (store) => store.put(value, 'enabled'), 'preferences');
		return (await idb('readonly', (store) => store.get('enabled'), 'preferences')) !== false;
	} catch {
		try {
			const cache = await caches.open('thingtime-media-preferences-v1');
			const key = cacheUrl('preferences');
			if (typeof value === 'boolean') await cache.put(key, new Response(String(value)));
			return (await (await cache.match(key))?.text()) !== 'false';
		} catch {
			return value !== false;
		}
	}
}
