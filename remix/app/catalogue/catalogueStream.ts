import { sha256 } from '@noble/hashes/sha2.js';

export type CatalogueIdentity = { domain: 'themes' | 'algorithms'; origin: string; ownerId: string; dataPlane: string; storagePlane: 'home' };
export type CatalogueHeader = CatalogueIdentity & { version: 1; generation: string };
export type CatalogueCompletion = CatalogueHeader & { entries: number; bytes: number; digest: string };
export type CatalogueStreamOptions = { signal?: AbortSignal; check?(): void; stallTimeoutMs?: number };
export type CatalogueSink = {
	/** These writes are provisional. Discard staging on any failure; never publish here. */
	entry(id: string, value: unknown, signal: AbortSignal): Promise<void>;
	/** Atomically admit staging only here, fencing identity, pending edits and this
	 * signal inside the transaction. A timeout cannot undo an already committed write. */
	complete(receipt: CatalogueCompletion, signal: AbortSignal): Promise<void>;
};
// Framing/resource bounds, never catalogue or entry size limits.
export const CATALOGUE_CHUNK_BYTES = 24 * 1024;
export const CATALOGUE_FRAME_BYTES = 40 * 1024;
const encoder = new TextEncoder();
const fail = () => new Error('Catalogue stream is incomplete or invalid. Keep the last complete catalogue.');
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
function identity(value: CatalogueIdentity) {
	if (!value || !['themes', 'algorithms'].includes(value.domain) || typeof value.ownerId !== 'string' ||
		!value.ownerId || value.ownerId.length > 1024 || typeof value.dataPlane !== 'string' || !value.dataPlane || value.dataPlane.length > 1024 ||
		value.storagePlane !== 'home' || typeof value.origin !== 'string' || new URL(value.origin).origin !== value.origin) throw fail();
}
function header(value: CatalogueHeader) {
	identity(value);
	if (value.version !== 1 || typeof value.generation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.generation)) throw fail();
}
function exact(value: Record<string, unknown>, keys: string[]) {
	if (Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw fail();
}
function validId(id: unknown): id is string { return typeof id === 'string' && id.length > 0 && encoder.encode(id).length <= 1024; }
function add(a: number, b: number) { const result = a + b; if (!Number.isSafeInteger(result)) throw fail(); return result; }
function guard(options: CatalogueStreamOptions) {
	const controller = new AbortController();
	const check = () => { controller.signal.throwIfAborted(); options.signal?.throwIfAborted(); options.check?.(); };
	const timeout = options.stallTimeoutMs ?? 240_000;
	if (!Number.isFinite(timeout) || timeout <= 0) throw fail();
	return { check, signal: controller.signal, close: () => controller.abort(), async wait<T>(operation: () => Promise<T>): Promise<T> {
		check(); let timer: ReturnType<typeof setTimeout> | undefined;
		let abort: (() => void) | undefined;
		try {
			const interrupted = new Promise<never>((_, reject) => {
				abort = () => { controller.abort(options.signal?.reason); reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
				options.signal?.addEventListener('abort', abort, { once: true });
				timer = setTimeout(() => { const error = new DOMException('Catalogue stream stalled', 'TimeoutError'); controller.abort(error); reject(error); }, timeout);
			});
			const result = await Promise.race([operation(), interrupted]); check(); return result;
		} finally { clearTimeout(timer); if (abort) options.signal?.removeEventListener('abort', abort); }
	} };
}
function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function unbase64(value: unknown) {
	if (typeof value !== 'string' || !value.length || value.length > CATALOGUE_CHUNK_BYTES / 3 * 4 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail();
	const result = Uint8Array.from(atob(value), char => char.charCodeAt(0));
	if (base64(result) !== value) throw fail(); return result;
}

/** Source must be owner-authorized, pinned to one DB snapshot and ordered by ID.
 * Awaited writes retain transport backpressure. This module supplies no auth or DB access. */
export async function writeCatalogueStream(start: CatalogueHeader,
	entries: AsyncIterable<{ id: string; value: unknown }> | ((signal: AbortSignal) => AsyncIterable<{ id: string; value: unknown }>),
	write: (bytes: Uint8Array, signal: AbortSignal) => Promise<void>, options: CatalogueStreamOptions = {}): Promise<CatalogueCompletion> {
	header(start); const gate = guard(options), hash = sha256.create();
	let count = 0, bytes = 0, previous = '';
	const emit = async (value: unknown, hashed = true) => {
		const frame = encoder.encode(JSON.stringify(value) + '\n');
		if (frame.length - 1 > CATALOGUE_FRAME_BYTES) throw fail();
		if (hashed) hash.update(frame); await gate.wait(() => write(frame, gate.signal));
	};
	const iterator = (typeof entries === 'function' ? entries(gate.signal) : entries)[Symbol.asyncIterator](); let exhausted = false;
	try {
	await emit({ type: 'start', ...start });
	for (;;) {
		const next = await gate.wait(() => iterator.next());
		if (next.done) { exhausted = true; break; }
		const entry = next.value;
		gate.check(); if (!validId(entry.id) || entry.id <= previous) throw fail();
		const json = JSON.stringify(entry.value); if (json === undefined) throw fail();
		const data = encoder.encode(json); let chunk = 0;
		for (let offset = 0; offset < data.length; offset += CATALOGUE_CHUNK_BYTES) {
			const part = data.subarray(offset, offset + CATALOGUE_CHUNK_BYTES);
			await emit({ type: 'entry', ordinal: count, id: entry.id, chunk: chunk++, data: base64(part), final: offset + part.length === data.length });
		}
		bytes = add(bytes, data.length); count = add(count, 1); previous = entry.id;
	}
	gate.check(); const receipt = { ...start, entries: count, bytes, digest: hex(hash.digest()) };
	await emit({ type: 'end', entries: count, bytes, digest: receipt.digest }, false); return receipt;
	} finally {
		gate.close();
		if (!exhausted && iterator.return) void Promise.resolve().then(() => iterator.return!()).catch(() => {});
	}
}

/** Retains only the current entry, plus bounded framing. Completion is withheld
 * until a validated terminal and clean EOF; sink.entry must write disposable staging. */
export async function readCatalogueStream(body: ReadableStream<Uint8Array>, expected: CatalogueIdentity,
	sink: CatalogueSink, options: CatalogueStreamOptions = {}): Promise<CatalogueCompletion> {
	identity(expected); const gate = guard(options), reader = body.getReader(), hash = sha256.create();
	let start: CatalogueHeader | undefined, terminal: CatalogueCompletion | undefined;
	let line: number[] = [], count = 0, bytes = 0, previous = '', activeId = '', chunk = 0;
	let entry = '', decoder = new TextDecoder('utf-8', { fatal: true });
	try {
		for (;;) {
			const part = await gate.wait(() => reader.read()); if (part.done) break;
			for (const byte of part.value) {
				if (terminal) throw fail();
				if (byte !== 10) { line.push(byte); if (line.length > CATALOGUE_FRAME_BYTES) throw fail(); continue; }
				const raw = Uint8Array.from(line); line = [];
				const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
				if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
				if (!start) {
					exact(value, ['type', 'version', 'domain', 'origin', 'ownerId', 'dataPlane', 'storagePlane', 'generation']); header(value);
					if (value.type !== 'start' || value.domain !== expected.domain || value.origin !== expected.origin || value.ownerId !== expected.ownerId ||
						value.dataPlane !== expected.dataPlane || value.storagePlane !== expected.storagePlane) throw fail();
					start = { version: 1, domain: value.domain, origin: value.origin, ownerId: value.ownerId, dataPlane: value.dataPlane,
						storagePlane: value.storagePlane, generation: value.generation };
				} else if (value.type === 'entry') {
					exact(value, ['type', 'ordinal', 'id', 'chunk', 'data', 'final']);
					if (value.ordinal !== count || value.chunk !== chunk || !validId(value.id) || typeof value.final !== 'boolean' ||
						(activeId ? value.id !== activeId : value.id <= previous)) throw fail();
					activeId = value.id; const data = unbase64(value.data); bytes = add(bytes, data.length);
					entry += decoder.decode(data, { stream: true }); chunk = add(chunk, 1);
					if (value.final) {
						entry += decoder.decode(); const parsed: unknown = JSON.parse(entry);
						const id = activeId;
						await gate.wait(() => sink.entry(id, parsed, gate.signal)); previous = activeId; activeId = ''; entry = ''; chunk = 0;
						decoder = new TextDecoder('utf-8', { fatal: true }); count = add(count, 1);
					}
				} else if (value.type === 'end') {
					exact(value, ['type', 'entries', 'bytes', 'digest']);
					if (activeId || value.entries !== count || value.bytes !== bytes || value.digest !== hex(hash.digest())) throw fail();
					terminal = { ...start, entries: count, bytes, digest: value.digest }; continue;
				} else throw fail();
				hash.update(raw); hash.update(Uint8Array.of(10));
			}
		}
		if (line.length || !terminal) throw fail();
		await gate.wait(() => sink.complete(terminal!, gate.signal)); return terminal;
	} finally {
		gate.close();
		// Do not let a hostile underlying cancel promise retain our reader lock.
		void reader.cancel().catch(() => {}); reader.releaseLock();
	}
}
