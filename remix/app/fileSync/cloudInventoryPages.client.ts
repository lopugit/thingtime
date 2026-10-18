import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { sameSyncScope, validateSyncScope, type SyncScope } from './reconcile';
import { CLOUD_INVENTORY_PAGES_REQUIREMENTS, CLOUD_INVENTORY_PAGE_BYTES, CLOUD_INVENTORY_TIMEOUT_MS,
	parseCloudInventoryPage, type CloudInventoryPage } from './cloudInventoryPages';

/** Bounded NDJSON decoding, even when one transport chunk contains many pages.
 * Completion is withheld until EOF so trailing errors cannot seal a capture. */
export async function* readCloudFolderInventoryPages(scope: SyncScope, folderId: string, input: {
	currentScope(): SyncScope;
	signal?: AbortSignal;
	origin?: () => string;
	fetch?: typeof fetch;
	requireCapability?: typeof requireThingtimeCapability;
}): AsyncGenerator<CloudInventoryPage> {
	validateSyncScope(scope);
	if (scope.dataPlane !== 'home' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(folderId)) throw Error('Choose a cloud folder in home storage.');
	const controller = new AbortController(), abort = () => controller.abort(input.signal?.reason);
	const timer = setTimeout(() => controller.abort(new DOMException('Cloud inventory timed out', 'TimeoutError')), CLOUD_INVENTORY_TIMEOUT_MS);
	if (input.signal?.aborted) abort(); else input.signal?.addEventListener('abort', abort, { once: true });
	const check = () => {
		controller.signal.throwIfAborted();
		if (scope.origin !== (input.origin ?? (() => window.location.origin))() || !sameSyncScope(scope, input.currentScope())) throw Error('Sync context changed.');
	};
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	try {
		check();
		for (const [feature, version] of Object.entries({ ...CLOUD_INVENTORY_PAGES_REQUIREMENTS, 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' })) {
			await (input.requireCapability ?? requireThingtimeCapability)(feature, version); check();
		}
		const response = await (input.fetch ?? fetch)(scope.origin + '/api/v1/files?' + new URLSearchParams({ rootId: folderId, pages: '1' }), {
			credentials: 'include', redirect: 'error', cache: 'no-store', signal: controller.signal,
			headers: { Accept: 'application/x-ndjson', 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': scope.dataPlane }
		});
		try {
			check();
			if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/x-ndjson' || !response.body)
				throw Error(`Cloud inventory stream is unavailable (${response.status}). Keep the last complete scan.`);
		} catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
		reader = response.body!.getReader();
		const decoder = new TextDecoder('utf-8', { fatal: true });
		let text = '', bytes = 0, count = 0, ordinal = 0, generation: string | undefined, revision: string | undefined;
		let terminal: CloudInventoryPage | undefined;
		for (;;) {
			check(); const part = await reader.read(); check();
			if (part.done) break;
			for (let start = 0; start < part.value.length;) {
				const newline = part.value.indexOf(10, start), end = newline === -1 ? part.value.length : newline;
				bytes += end - start;
				if (bytes > CLOUD_INVENTORY_PAGE_BYTES) throw Error('Cloud inventory page exceeds its byte bound.');
				text += decoder.decode(part.value.subarray(start, end), { stream: true });
				start = end + (newline === -1 ? 0 : 1);
				if (newline === -1) continue;
				text += decoder.decode();
				if (terminal) throw Error('Cloud inventory continued after its final page.');
				let value: unknown; try { value = JSON.parse(text); } catch { throw Error('Cloud inventory page is malformed.'); }
				const page = parseCloudInventoryPage(value, folderId); text = ''; bytes = 0;
				if (page.ordinal !== ordinal || (generation !== undefined && page.generation !== generation) ||
					(revision !== undefined && page.rootRevision !== revision)) throw Error('Cloud inventory generation or page order changed.');
				generation = page.generation; revision = page.rootRevision; ordinal++; count += page.nodes.length;
				if (!Number.isSafeInteger(count)) throw Error('Cloud inventory count exceeds its bound.');
				check();
				if (page.totalEntries !== undefined) {
					if (page.totalEntries !== count) throw Error('Cloud inventory completion count changed.');
					terminal = page;
				} else yield page;
			}
		}
		if (bytes || text || !terminal) throw Error('Cloud inventory was interrupted before completion. Keep the last complete scan.');
		check(); yield terminal;
	} finally {
		controller.abort(); clearTimeout(timer); input.signal?.removeEventListener('abort', abort);
		if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock(); }
	}
}
