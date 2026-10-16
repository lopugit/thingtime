import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import { planFileSync, validSyncEntry, type SyncEntry } from './reconcile';
import type { FingerprintSource } from './contentFingerprint';

export type MobileFolder = { id: string; name: string };
export type FolderRequest =
	| { action: 'list' | 'choose' }
	| { action: 'remove' | 'scan'; rootId: string }
	| { action: 'read'; rootId: string; path: string; version: string; offset: number; length: number };
export type FolderResult = { roots: MobileFolder[]; entries?: SyncEntry[]; chunk?: { version: string; size: number; offset: number; data: string } };
export const supportsMobileFolders = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()) =>
	Boolean(bridge?.isNativeWebView && (bridge.platform === 'ios' || bridge.platform === 'android') && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? ''));
export function parseMobileFolderResult(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string },
	request: FolderRequest
): FolderResult | null {
	const message = value as any,
		payload = message?.payload;
	if (message?.type !== 'mobile-files-result' || !payload || Object.entries(expected).some(([key, value]) => payload[key] !== value)) return null;
	if (typeof payload.error === 'string') throw Error(payload.error.slice(0, 240));
	if (
		!Array.isArray(payload.roots) ||
		payload.roots.length > 32 ||
		new Set(payload.roots.map((r: any) => r?.id)).size !== payload.roots.length ||
		payload.roots.some(
			(r: any) => typeof r?.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(r.id) || typeof r.name !== 'string' || !r.name || r.name.length > 1024
		)
	)
		throw Error('Invalid native folder response.');
	const result: FolderResult = { roots: payload.roots.map((r: any) => ({ id: r.id, name: r.name })) };
	if (request.action === 'scan') {
		if (
			payload.rootId !== request.rootId ||
			payload.complete !== true ||
			!Array.isArray(payload.entries) ||
			payload.entries.length > 10_000 ||
			payload.entries.some((e: any) => !validSyncEntry(e))
		)
			throw Error('Folder scan is incomplete. Keep the existing sync state.');
		const scope = { ...expected, dataPlane: 'home', rootId: request.rootId, deviceId: 'native-scan' };
		// Reuse the planner's bounds, path/identity collision and ancestry checks.
		planFileSync(
			{ scope, complete: true, entries: payload.entries },
			{ scope, complete: true, entries: [] },
			{ scope, entries: [] },
			{ mode: 'backup', propagateDeletes: false }
		);
		result.entries = structuredClone(payload.entries);
	} else if (request.action === 'read') {
		const c = payload.chunk;
		if (
			payload.rootId !== request.rootId ||
			payload.path !== request.path ||
			c?.version !== request.version ||
			c.offset !== request.offset ||
			!Number.isSafeInteger(c.size) ||
			c.size < request.offset ||
			typeof c.data !== 'string' ||
			c.data.length > 87384 ||
			!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(c.data) ||
			atob(c.data).length !== Math.min(request.length, c.size - request.offset)
		)
			throw Error('Native file changed or returned incomplete bytes.');
		result.chunk = { version: c.version, size: c.size, offset: c.offset, data: c.data };
	}
	return result;
}
export function requestMobileFolders(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult> {
	const bridge = getNativeBridge();
	if (!supportsMobileFolders(bridge)) return Promise.reject(Error('Folder access requires an updated mobile app.'));
	const input = structuredClone(request),
		expected = { requestId: crypto.randomUUID(), ownerId, origin: window.location.origin };
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			window.removeEventListener(nativeBridgeMessageEvent, listener);
			signal.removeEventListener('abort', abort);
		};
		const stop = () => {
			try {
				bridge!.postMessage({ type: 'mobile-files', payload: { ...expected, action: 'suspend' } });
			} catch {
				/* The caller still stops waiting. */
			}
		};
		const abort = () => {
			cleanup();
			stop();
			reject(new DOMException('Folder request cancelled', 'AbortError'));
		};
		const listener = (event: Event) => {
			try {
				const result = parseMobileFolderResult((event as CustomEvent).detail, expected, input);
				if (result) {
					cleanup();
					resolve(result);
				}
			} catch (error) {
				cleanup();
				reject(error);
			}
		};
		const timer = setTimeout(
			() => {
				cleanup();
				stop();
				reject(Error('Folder access timed out. Your saved selections are preserved.'));
			},
			input.action === 'choose' || input.action === 'scan' ? 300_000 : 30_000
		);
		window.addEventListener(nativeBridgeMessageEvent, listener);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
			return;
		}
		try {
			bridge!.postMessage({ type: 'mobile-files', payload: { ...expected, ...input } });
		} catch (error) {
			cleanup();
			reject(error);
		}
	});
}
/** Bounded native reads can feed the shared fingerprint/upload source contract.
 * Production native workers can stream directly without round-tripping bytes
 * through JavaScript. Every chunk remains tied to the scanned source version. */
export function mobileFolderSource(ownerId: string, rootId: string, scanned: SyncEntry, signal: AbortSignal): FingerprintSource {
	const entry = structuredClone(scanned);
	if (!validSyncEntry(entry) || entry.kind !== 'file') throw Error('Select a scanned file.');
	const verify = async () => {
		signal.throwIfAborted();
		const result = await requestMobileFolders(
			ownerId,
			{ action: 'read', rootId, path: entry.path, version: entry.version, offset: 0, length: 1 },
			signal
		);
		if (result.chunk!.size !== entry.size) throw Error('Native source changed.');
	};
	return {
		size: entry.size,
		check: verify,
		read: async (offset, length, callerSignal) => {
			const readSignal = callerSignal ? AbortSignal.any([signal, callerSignal]) : signal;
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				!Number.isSafeInteger(length) ||
				length < 0 ||
				length > 32 * 1024 * 1024 ||
				offset + length > entry.size
			)
				throw Error('Invalid native read range.');
			const bytes = new Uint8Array(length);
			for (let at = 0; at < length; at += 65536) {
				readSignal.throwIfAborted();
				const response = await requestMobileFolders(
					ownerId,
					{ action: 'read', rootId, path: entry.path, version: entry.version, offset: offset + at, length: Math.min(65536, length - at) },
					readSignal
				);
				if (response.chunk!.size !== entry.size) throw Error('Native source changed.');
				const binary = atob(response.chunk!.data);
				bytes.set(
					Uint8Array.from(binary, (c) => c.charCodeAt(0)),
					at
				);
			}
			readSignal.throwIfAborted();
			return bytes;
		}
	};
}
