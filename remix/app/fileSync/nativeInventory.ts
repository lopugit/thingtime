import { validSyncEntry, type SyncEntry } from './reconcile';
import type { FolderRequest, FolderResult } from './mobileFolders.client';

export type NativeInventoryCapture = { id: string; generation: string; totalEntries: number };
export type NativeInventoryPage = { capture: NativeInventoryCapture; offset: number; entries: SyncEntry[]; nextOffset: number | null };
export type LocalInventoryPage = { generation: string; ordinal: number; entries: SyncEntry[]; totalEntries?: number };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function parseNativeInventoryCapture(value: unknown): NativeInventoryCapture {
	const c = value as NativeInventoryCapture;
	if (!c || typeof c.id !== 'string' || !uuid.test(c.id) || typeof c.generation !== 'string' || !uuid.test(c.generation) ||
		!Number.isSafeInteger(c.totalEntries) || c.totalEntries < 0) throw Error('Invalid native inventory generation.');
	return { id: c.id, generation: c.generation, totalEntries: c.totalEntries };
}
export function parseNativeInventoryPage(value: unknown, capture: NativeInventoryCapture, offset: number): NativeInventoryPage {
	const p = value as NativeInventoryPage, expected = parseNativeInventoryCapture(capture);
	if (!p || JSON.stringify(parseNativeInventoryCapture(p.capture)) !== JSON.stringify(expected) ||
		!Number.isSafeInteger(offset) || offset < 0 || p.offset !== offset || !Array.isArray(p.entries) || p.entries.length > 128 ||
		p.entries.some(entry => !validSyncEntry(entry))) throw Error('Native inventory page changed.');
	const next = offset + p.entries.length;
	if (next > expected.totalEntries || (!p.entries.length && (offset !== 0 || expected.totalEntries !== 0)) ||
		p.nextOffset !== (next === expected.totalEntries ? null : next)) throw Error('Native inventory page is incomplete.');
	const result = { capture: expected, offset, entries: structuredClone(p.entries), nextOffset: p.nextOffset };
	if (new TextEncoder().encode(JSON.stringify(result)).length > 512 * 1024) throw Error('Native inventory page exceeds its byte bound.');
	return result;
}

/** Import only one sealed generation. Missing, reordered or substituted pages
 * never become an empty scan; the caller seals its journal after the final count. */
export async function* readNativeInventory(input: {
	ownerId: string; deviceId: string; rootId: string; signal: AbortSignal;
	request(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult>;
}): AsyncGenerator<LocalInventoryPage> {
	const { ownerId, deviceId: inventoryDeviceId, rootId, signal, request } = input;
	let capture: NativeInventoryCapture | undefined;
	try {
		signal.throwIfAborted();
		const captureId = crypto.randomUUID();
		capture = parseNativeInventoryCapture((await request(ownerId, { action: 'scan-capture', rootId, inventoryDeviceId, captureId }, signal)).capture);
		if (capture.id !== captureId) throw Error('Native capture identity changed.');
		let offset = 0, ordinal = 0;
		while (true) {
			signal.throwIfAborted();
			const response = await request(ownerId, { action: 'scan-page', rootId, inventoryDeviceId, capture, offset }, signal);
			signal.throwIfAborted();
			const page = parseNativeInventoryPage(response.inventoryPage, capture, offset);
			yield { generation: capture.generation, ordinal: ordinal++, entries: page.entries,
				...(page.nextOffset === null ? { totalEntries: capture.totalEntries } : {}) };
			if (page.nextOffset === null) return;
			offset = page.nextOffset;
		}
	} finally {
		// Owner changes/cancellation can refuse cleanup. The native cache evicts
		// old captures under its scope lock, so an abandoned request stays bounded.
		if (capture && !signal.aborted) await request(ownerId, { action: 'scan-discard', rootId, inventoryDeviceId, capture }, signal).catch(() => {});
	}
}
