/** Exact-version, bounded byte reads. Authorization and object signing remain in
 * the canonical attachment service; signed storage URLs never reach the caller. */
// Keep buffered binary responses below hosted function payload limits, even
// when an adapter base64-encodes them. Larger files use repeated pinned reads.
export const MAX_ATTACHMENT_RANGE_BYTES = 2 * 1024 * 1024;
export type AttachmentRange = { version: string; offset: number; length: number };
export function parseAttachmentRange(url: URL): AttachmentRange | null {
	if (!url.searchParams.has('range')) return null;
	const get = (key: string) => (url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key)! : '');
	const version = get('version'),
		offset = get('offset'),
		length = get('length');
	if (
		get('range') !== '1' ||
		!/^[a-f0-9]{64}$/.test(version) ||
		!/^(0|[1-9][0-9]*)$/.test(offset) ||
		!/^[1-9][0-9]*$/.test(length) ||
		!Number.isSafeInteger(Number(offset)) ||
		!Number.isSafeInteger(Number(length)) ||
		Number(length) > MAX_ATTACHMENT_RANGE_BYTES ||
		!Number.isSafeInteger(Number(offset) + Number(length)) ||
		['width', 'cache', 'fingerprint', 'download'].some((k) => url.searchParams.has(k))
	)
		throw Error('Invalid attachment byte range.');
	return { version, offset: Number(offset), length: Number(length) };
}
export async function readExactRange(response: Response, range: AttachmentRange, size: number, check: () => void): Promise<Uint8Array<ArrayBuffer>> {
	const expected = `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`;
	if (
		response.status !== 206 ||
		response.headers.get('Content-Range') !== expected ||
		(response.headers.has('Content-Length') && response.headers.get('Content-Length') !== String(range.length)) ||
		(response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding') !== 'identity') ||
		!response.body
	) {
		await response.body?.cancel();
		throw Error('Storage did not return the exact requested range.');
	}
	const result = new Uint8Array(range.length),
		reader = response.body.getReader();
	let offset = 0;
	try {
		for (;;) {
			check();
			const next = await reader.read();
			check();
			if (next.done) break;
			if (offset + next.value.length > result.length) throw Error('Storage byte range exceeded its bound.');
			result.set(next.value, offset);
			offset += next.value.length;
		}
		if (offset !== result.length) throw Error('Storage byte range was incomplete.');
		return result;
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
