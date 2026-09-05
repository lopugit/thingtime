import { MAX_AGE, MAX_FILE_BYTES } from './media-cache-store.mjs';

export const REQUIREMENTS = { 'api.attachment-content': '1.1.0' };
export function compatibleManifest(manifest, origin) {
	if (manifest?.schemaVersion !== 1 || manifest.origin !== origin) return false;
	return Object.entries(REQUIREMENTS).every(([feature, required]) => {
		const actual = manifest.features?.[feature]?.version;
		if (!/^\d+\.\d+\.\d+$/.test(actual || '')) return false;
		const [major, minor, patch] = actual.split('.').map(Number);
		const [rm, rn, rp] = required.split('.').map(Number);
		return major === rm && (minor > rn || (minor === rn && patch >= rp));
	});
}
export function managedUrl(request, origin) {
	const url = new URL(request.url);
	return request.method === 'GET' &&
		!request.headers.has('Authorization') &&
		request.credentials !== 'omit' &&
		url.origin === origin &&
		url.pathname === '/api/v1/attachments/content' &&
		url.searchParams.has('id') &&
		!url.searchParams.has('cache')
		? url
		: null;
}
export function publicAsset(request, origin) {
	const url = new URL(request.url);
	// No documents, executable bundles, account APIs, bearer headers or signed URLs.
	if (request.method !== 'GET' || request.headers.has('Authorization') || request.headers.has('Range') || url.search) return false;
	if (url.origin !== origin && url.hostname !== 's3.thingtime.com') return false;
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__tt_media_cache__/')) return false;
	return (
		['image', 'audio', 'video', 'font', 'track'].includes(request.destination) ||
		/\.(?:png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|mp4|webm|mp3|m4a|ogg|wav|pdf|zip)$/i.test(url.pathname)
	);
}
export function publicLifetime(response) {
	if (response.status !== 200 || response.type === 'opaque' || response.headers.has('Set-Cookie')) return 0;
	const policy = response.headers.get('Cache-Control') || '';
	if (/\b(no-store|no-cache|private)\b/i.test(policy) || Boolean(response.headers.get('Vary'))) return 0;
	const seconds = Number(policy.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1] || 0);
	return Math.min(MAX_AGE, Math.max(0, seconds * 1000 - Number(response.headers.get('Age') || 0) * 1000));
}
export function responseFromRecord(record, range) {
	const headers = new Headers(record.headers);
	headers.set('Cache-Control', 'private, no-cache');
	headers.set('X-Thingtime-Media-Cache', 'hit');
	headers.set('Accept-Ranges', 'bytes');
	if (!range) {
		headers.set('Content-Length', String(record.bytes.size));
		return new Response(record.bytes, { headers });
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(range);
	if (!match || (!match[1] && !match[2])) return null;
	const size = record.bytes.size;
	const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
	const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
	if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
	headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
	headers.set('Content-Length', String(end - start + 1));
	return new Response(record.bytes.slice(start, end + 1), { status: 206, headers });
}
export async function boundedBlob(response) {
	if (response.status !== 200 || !response.body || response.type === 'opaque') return null;
	if (Number(response.headers.get('Content-Length')) > MAX_FILE_BYTES) return null;
	const reader = response.body.getReader();
	const parts = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_FILE_BYTES) {
				void reader.cancel();
				return null;
			}
			parts.push(value);
		}
		const expected = Number(response.headers.get('Content-Length'));
		if (!size || (expected && expected !== size && !response.headers.has('Content-Encoding'))) return null;
		return new Blob(parts, { type: response.headers.get('Content-Type') || 'application/octet-stream' });
	} catch {
		return null;
	}
}
