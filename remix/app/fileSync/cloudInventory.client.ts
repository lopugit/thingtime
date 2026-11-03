import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { createApiFailure } from '../hooks/apiFailure';
import { CLOUD_INVENTORY_REQUIREMENTS, MAX_CLOUD_INVENTORY_BYTES, parseCloudInventory } from './cloudInventory';
import { sameSyncScope, validateSyncScope, type SyncScope } from './reconcile';

/** Native/background workers can use the same response contract. Browser reads
 * pin both session identity and home storage; no cached or partial inventory is
 * ever substituted for a fresh complete observation. */
export async function readCloudFolderInventory(
	scope: SyncScope,
	folderId: string,
	input: {
		currentScope(): SyncScope;
		signal?: AbortSignal;
		origin?: () => string;
		fetch?: typeof fetch;
		requireCapability?: typeof requireThingtimeCapability;
	}
) {
	const controller = new AbortController(),
		abort = () => controller.abort(input.signal?.reason);
	const timer = setTimeout(() => controller.abort(new DOMException('Cloud inventory timed out', 'TimeoutError')), 30_000);
	if (input.signal?.aborted) abort();
	else input.signal?.addEventListener('abort', abort, { once: true });
	try {
		validateSyncScope(scope);
		if (scope.dataPlane !== 'home' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(folderId)) throw Error('Choose a cloud folder in home storage.');
		const check = () => {
			controller.signal.throwIfAborted();
			if (scope.origin !== (input.origin ?? (() => window.location.origin))()) throw Error('Sync origin changed.');
			if (!sameSyncScope(scope, input.currentScope())) throw Error('Sync context changed.');
		};
		check();
		await (input.requireCapability ?? requireThingtimeCapability)('api.files', CLOUD_INVENTORY_REQUIREMENTS['api.files']);
		check();
		await (input.requireCapability ?? requireThingtimeCapability)('api.actions-run', '1.7.0');
		check();
		await (input.requireCapability ?? requireThingtimeCapability)('api.mongodb-endpoint', '1.1.0');
		check();
		const response = await (input.fetch ?? fetch)(scope.origin + '/api/v1/files?rootId=' + encodeURIComponent(folderId), {
			credentials: 'include',
			redirect: 'error',
			cache: 'no-store',
			signal: controller.signal,
			headers: { Accept: 'application/json', 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': scope.dataPlane }
		});
		try {
			check();
		} catch (error) {
			await response.body?.cancel().catch(() => {});
			throw error;
		}
		if (!response.body) throw Error('A complete cloud inventory was not returned.');
		const reader = response.body.getReader(),
			decoder = new TextDecoder('utf-8', { fatal: true });
		let bytes = 0,
			text = '',
			ended = false;
		try {
			while (true) {
				check();
				const part = await reader.read();
				check();
				if (part.done) {
					ended = true;
					break;
				}
				bytes += part.value.byteLength;
				if (bytes > MAX_CLOUD_INVENTORY_BYTES + 1024) throw Error('Cloud inventory response exceeds its size bound.');
				text += decoder.decode(part.value, { stream: true });
			}
			text += decoder.decode();
		} finally {
			if (!ended) await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
		let payload: any;
		try {
			payload = JSON.parse(text);
		} catch {
			throw Error('A complete cloud inventory was not returned.');
		}
		if (!response.ok || payload?.ok !== true)
			throw createApiFailure({ payload, status: response.status, method: 'GET', action: 'scan the cloud folder' });
		check();
		return parseCloudInventory(payload.inventory, folderId);
	} finally {
		clearTimeout(timer);
		input.signal?.removeEventListener('abort', abort);
	}
}
