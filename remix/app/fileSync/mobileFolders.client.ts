import { validateLocalStage, type LocalStagedCopy } from './localSyncTarget';
import type { SyncOperation, SyncReceiptLookup } from './execute';
import { sameSyncScope, sameSyncContent, type SyncScope } from './reconcile';
import type { SyncConditions } from './configuredPlan';
import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '../utils/nativeBridge';
import { planFileSync, validSyncEntry, type SyncEntry } from './reconcile';
import type { FingerprintSource } from './contentFingerprint';

export type MobileFolder = { id: string; name: string; publicationVersion?: string };
export type MobileStageRequest = { scope: SyncScope; rootId: string; operation: SyncOperation };
export type MobileWriteApproval = { scope: SyncScope; configurationRevision: string; configurationHash: string };
export type FolderRequest =
	| { action: 'list' | 'choose' | 'conditions' }
	| { action: 'remove' | 'scan'; rootId: string }
	| { action: 'read'; rootId: string; path: string; version: string; offset: number; length: number; verifiedChunks?: true }
	| { action: 'stage-begin' | 'stage-finish'; rootId: string; transfer: MobileStageRequest }
	| { action: 'stage-append'; rootId: string; transfer: MobileStageRequest; offset: number; data: string }
	| { action: 'write-approve'; rootId: string; approval: MobileWriteApproval }
	| { action: 'publication-lookup'; rootId: string; transfer: MobileStageRequest }
	| { action: 'publish'; rootId: string; transfer: MobileStageRequest; stage: LocalStagedCopy; approval: MobileWriteApproval };
export type FolderResult = {
	writeApproval?: MobileWriteApproval;
	publication?: SyncReceiptLookup;
	staging?: { received: number; stage?: LocalStagedCopy };
	roots: MobileFolder[];
	conditions?: SyncConditions;
	entries?: SyncEntry[];
	chunk?: { version: string; size: number; offset: number; data: string };
};
export type FolderCapabilities = Pick<ThingtimeNativeBridge, 'platform' | 'fileAccessVersion' | 'fileStagingVersion' | 'filePublicationVersion'>;
export const supportsFolderAccess = (bridge: FolderCapabilities | undefined) =>
	Boolean(bridge && ['ios', 'android', 'macos'].includes(bridge.platform) && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? ''));
export const supportsMobileFolders = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()) =>
	Boolean(
		bridge?.isNativeWebView && (bridge.platform === 'ios' || bridge.platform === 'android') && /^1\.\d+\.\d+$/.test(bridge.fileAccessVersion ?? '')
	);
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
			(r: any) =>
				typeof r?.id !== 'string' ||
				!/^[a-f0-9-]{36}$/i.test(r.id) ||
				typeof r.name !== 'string' ||
				!r.name ||
				r.name.length > 1024 ||
				(r.publicationVersion !== undefined &&
					(typeof r.publicationVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(r.publicationVersion) || r.publicationVersion.length > 32))
		)
	)
		throw Error('Invalid native folder response.');
	const result: FolderResult = {
		roots: payload.roots.map((r: any) => ({
			id: r.id,
			name: r.name,
			...(r.publicationVersion !== undefined ? { publicationVersion: r.publicationVersion } : {})
		}))
	};
	if (request.action === 'write-approve') {
		const approved = payload.writeApproval;
		if (
			payload.rootId !== request.rootId ||
			!approved ||
			!sameSyncScope(approved.scope, request.approval.scope) ||
			approved.configurationRevision !== request.approval.configurationRevision ||
			approved.configurationHash !== request.approval.configurationHash
		)
			throw Error('Native folder write approval changed.');
		result.writeApproval = structuredClone(request.approval);
	} else if (request.action === 'publication-lookup' || request.action === 'publish') {
		const publication = payload.publication,
			receipt = publication?.receipt,
			m = request.transfer.operation.mutation;
		if (
			payload.rootId !== request.rootId ||
			!['missing', 'pending', 'complete'].includes(publication?.status) ||
			(request.action === 'publish' && publication.status !== 'complete')
		)
			throw Error('Native publication is not confirmed.');
		if (publication.status === 'complete') {
			if (
				m.kind !== 'copy' ||
				m.from !== 'remote' ||
				receipt?.operationId !== request.transfer.operation.id ||
				!sameSyncScope(receipt?.scope, request.transfer.scope) ||
				!validSyncEntry(receipt?.entry) ||
				receipt.entry.path !== m.path ||
				!sameSyncContent(receipt.entry, m.source)
			)
				throw Error('Invalid native publication receipt.');
			result.publication = { status: 'complete', receipt: structuredClone(receipt) };
		} else result.publication = { status: publication.status };
	} else if (request.action === 'stage-begin' || request.action === 'stage-append' || request.action === 'stage-finish') {
		const state = payload.staging,
			m = request.transfer.operation.mutation;
		if (
			payload.rootId !== request.rootId ||
			m.kind !== 'copy' ||
			m.from !== 'remote' ||
			!Number.isSafeInteger(state?.received) ||
			state.received < 0 ||
			state.received > m.source.size ||
			(request.action === 'stage-append' && state.received < request.offset + atob(request.data).length)
		)
			throw Error('Invalid native staging progress.');
		if (state.stage !== undefined && state.stage !== null) {
			validateLocalStage(state.stage, request.transfer.operation, request.transfer.scope);
			if (state.received !== m.source.size) throw Error('Incomplete native stage.');
		} else if (request.action === 'stage-finish') throw Error('Native bytes have not been verified.');
		result.staging = { received: state.received, ...(state.stage ? { stage: structuredClone(state.stage) } : {}) };
	} else if (request.action === 'conditions') {
		const c = payload.conditions;
		if (!c || !['wifi', 'cellular', 'ethernet', 'offline', 'unknown'].includes(c.network) || (c.charging !== null && typeof c.charging !== 'boolean'))
			throw Error('Native transfer conditions are unavailable.');
		result.conditions = { network: c.network, charging: c.charging };
	} else if (request.action === 'scan') {
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
export const supportsMobileSyncConditions = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsFolderAccess(bridge) && Number(bridge!.fileAccessVersion!.split('.')[1]) >= 1;
export const supportsMobileStaging = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsFolderAccess(bridge) && /^1\.\d+\.\d+$/.test(bridge?.fileStagingVersion ?? '');
export const supportsMobilePublication = (bridge: FolderCapabilities | undefined = getNativeBridge()) =>
	supportsMobileStaging(bridge) && /^1\.\d+\.\d+$/.test(bridge?.filePublicationVersion ?? '');
/** Publication 1.1 adds explicit per-folder capability. Earlier iOS 1.0
 * adapters support their selected roots; Android never falls back to that rule. */
export function supportsMobileFolderPublication(folder: MobileFolder | undefined, bridge: FolderCapabilities | undefined = getNativeBridge()) {
	if (!folder || !supportsMobilePublication(bridge)) return false;
	if (Number(bridge!.filePublicationVersion!.split('.')[1]) >= 1) return /^1\.\d+\.\d+$/.test(folder.publicationVersion ?? '');
	return bridge!.platform === 'ios';
}
export function requestMobileFolders(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult> {
	const bridge = getNativeBridge();
	if (!supportsMobileFolders(bridge)) return Promise.reject(Error('Folder access requires an updated mobile app.'));
	if (request.action === 'conditions' && !supportsMobileSyncConditions(bridge))
		return Promise.reject(Error('Update the mobile app to run folder transfers.'));
	if (request.action.startsWith('stage-') && !supportsMobileStaging(bridge))
		return Promise.reject(Error('Update the mobile app to receive staged files.'));
	if (['write-approve', 'publication-lookup', 'publish'].includes(request.action) && !supportsMobilePublication(bridge))
		return Promise.reject(Error('Update the mobile app to download into selected folders.'));
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
			['choose', 'scan', 'stage-begin', 'stage-finish', 'write-approve', 'publish', 'publication-lookup'].includes(input.action) ? 300_000 : 30_000
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
export function mobileFolderSource(
	ownerId: string,
	rootId: string,
	scanned: SyncEntry,
	signal: AbortSignal,
	request = requestMobileFolders,
	bridge: FolderCapabilities | undefined = getNativeBridge()
): FingerprintSource {
	const entry = structuredClone(scanned);
	if (!validSyncEntry(entry) || entry.kind !== 'file') throw Error('Select a scanned file.');
	const chunkProofs = bridge?.platform === 'android' && supportsFolderAccess(bridge) && Number(bridge!.fileAccessVersion!.split('.')[1]) >= 2;
	const verify = async (full = false) => {
		signal.throwIfAborted();
		const result = await request(
			ownerId,
			{
				action: 'read',
				rootId,
				path: entry.path,
				version: entry.version,
				offset: 0,
				length: 1,
				...(!full && chunkProofs ? { verifiedChunks: true as const } : {})
			},
			signal
		);
		if (result.chunk!.size !== entry.size) throw Error('Native source changed.');
	};
	return {
		size: entry.size,
		check: () => verify(),
		verify: () => verify(true),
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
				const response = await request(
					ownerId,
					{
						action: 'read',
						rootId,
						path: entry.path,
						version: entry.version,
						offset: offset + at,
						length: Math.min(65536, length - at),
						...(chunkProofs ? { verifiedChunks: true as const } : {})
					},
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
