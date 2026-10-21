import { SyncConnectionWait } from './syncConnectionWait';
import { createFolderHostFetch } from './folderHostFetch.client';
import type { ThingtimeDesktopBridge } from '../utils/electronBridge';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import {
	parseMobileFolderResult,
	assertNativeScanExclusions,
	supportsFolderAccess,
	supportsNativeResourceLimits,
	supportsNativeAuthorizationContext,
	supportsNativePathInspection,
	supportsNativeInventoryPages,
	supportsNativeUploadBatches,
	supportsNativeFolderBatches,
	type FolderCapabilities,
	type FolderRequest,
	type FolderResult,
	type requestMobileFolders
} from './mobileFolders.client';

export type FolderHost = {
	origin(): string;
	capabilities: FolderCapabilities | undefined;
	request: typeof requestMobileFolders;
	authorizeDevice(ownerId: string, deviceId: string, signal: AbortSignal): Promise<void>;
	authorizeContext?(ownerId: string, deviceId: string, signal: AbortSignal): Promise<{ roots: FolderResult['roots']; conditions: NonNullable<FolderResult['conditions']> }>;
	uploadBatch?: import('./uploadBatch').NativeUploadBatch;
	folderBatch?: import('./folderBatch').NativeFolderBatch;
	fetch: typeof fetch;
	requireCapability(feature: string, minimumVersion: string): Promise<void>;
	assertCurrent(): void;
};
type ContextReply = {
	authorization?: { roots: FolderResult['roots']; conditions: NonNullable<FolderResult['conditions']> };
	origin: string;
	capabilities: FolderCapabilities;
	apiCapabilities: { schemaVersion: 1; origin: string; features: Record<string, { version: string }> };
};
const queues = new WeakMap<object, Promise<unknown>>();
// Match Electron/native lanes: long polls must not hold ordinary file IO.
// Each lane remains serialized across hosts sharing the same bridge.
const streamWaiterQueues = new WeakMap<object, Promise<unknown>>();
const changed = () => Error('The account, device or sync server changed. Reopen folder access.');
const canonicalOrigin = (value: unknown): string => {
	if (typeof value !== 'string') throw changed();
	const url = new URL(value);
	if (
		url.origin !== value ||
		url.username ||
		url.password ||
		(url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
	)
		throw changed();
	return value;
};

/** Bind the shared folder runner to the host-verified account/device/server.
 * Only authenticated API requests are remapped to the bundled cookie session.
 * Public signed uploads retain their exact URL and credentials:omit contract. */
export async function createDesktopFolderHost(input: {
	ownerId: string;
	deviceId: string;
	bridge: Pick<ThingtimeDesktopBridge, 'folderSyncRequest'>;
	signal: AbortSignal;
	rendererOrigin(): string;
	assertCurrent(): void;
	fetch?: typeof fetch;
	resourcePolicy?: { resourceLimits: import('./configuration').FileSyncResourceLimits; resourceScope: string; observe(value: import('./resourceGovernor').SyncResourceStatus): void };
}): Promise<FolderHost> {
	const invoke = input.bridge.folderSyncRequest,
		ownerId = input.ownerId,
		deviceId = input.deviceId;
	if (!invoke) throw Error('Update Thingtime Desktop to use local folders.');
	const localOrigin = canonicalOrigin(input.rendererOrigin());
	let origin: string | undefined;
	const check = () => {
		input.signal.throwIfAborted();
		input.assertCurrent();
		if (input.rendererOrigin() !== localOrigin) throw changed();
	};
	const send = async (request: FolderRequest | { action: 'context' }, signal: AbortSignal) => {
		check();
		signal.throwIfAborted();
		const payload = structuredClone(request);
		if ('rootId' in payload && input.resourcePolicy) Object.assign(payload, { resourceLimits: input.resourcePolicy.resourceLimits, resourceScope: input.resourcePolicy.resourceScope });
		const expected = { requestId: crypto.randomUUID(), ownerId, deviceId, ...(origin ? { origin } : {}) };
		const combined = AbortSignal.any([input.signal, signal, AbortSignal.timeout(300_000)]);
		return await new Promise<any>((resolve, reject) => {
			let dispatched = false;
			const abort = () => {
				if (dispatched) void invoke({ ...expected, action: 'suspend' }).catch(() => {});
				reject(combined.reason ?? new DOMException('Folder request cancelled', 'AbortError'));
			};
			combined.addEventListener('abort', abort, { once: true });
			if (combined.aborted) {
				abort();
				return;
			}
			const queue = payload.action === 'scan-changes' ? streamWaiterQueues : queues;
			const queued = (queue.get(input.bridge) ?? Promise.resolve())
				.catch(() => {})
				.then(() => {
					combined.throwIfAborted();
					check();
					dispatched = true;
					return invoke({ ...expected, ...payload }).catch((error: unknown) => {
						// Electron wraps rejected IPC messages and discards custom error
						// fields. Only recognize fixed host compatibility/retry messages;
						// never display arbitrary native errors, paths or transport details.
						const retry = '[folder_identity_retry] Folder identity verification is temporarily unavailable. Retry after reconnecting.';
						const uploadRetry = '[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.';
						if (error instanceof Error && (error.message === uploadRetry ||
							error.message === `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${uploadRetry}`))
							throw new SyncConnectionWait('Waiting for upload transport to reconnect. Saved transfer progress will continue automatically.');
						const transportRetry = '[folder_transport_retry] Folder service is temporarily unavailable. Retry after reconnecting.';
						if (error instanceof Error && (error.message === transportRetry ||
							error.message === `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${transportRetry}`))
							throw new SyncConnectionWait('Waiting for the local folder service to reconnect. Saved transfer progress will continue automatically.');
						const shutdown = '[folder_sync_shutdown] Thingtime is closing. Saved sync work can resume when reopened.';
						if (error instanceof Error && (error.message === shutdown ||
							error.message === `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${shutdown}`))
							throw new SyncConnectionWait('Thingtime is closing. Saved sync work will resume when reopened.');
						if (error instanceof Error && (error.message === retry ||
							error.message === `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${retry}`))
							throw new SyncConnectionWait('Waiting for folder access verification to reconnect.', undefined, 'folder-identity');
						const unsupported = 'The selected server does not support this version of folder sync.';
						if (error instanceof Error && (error.message === unsupported ||
							error.message === `Error invoking remote method 'thingtime-desktop:folder-sync': Error: ${unsupported}`))
							throw Error(unsupported);
						throw Error('Folder access could not be verified. Check the connection, pairing and selected account.');
					});
				});
			queue.set(
				input.bridge,
				queued.catch(() => {})
			);
			queued
				.then((value) => {
					combined.throwIfAborted();
					check();
					const reply = value as Record<string, unknown>;
					if (
						!reply ||
						reply.requestId !== expected.requestId ||
						reply.ownerId !== expected.ownerId ||
						reply.deviceId !== expected.deviceId ||
						(origin !== undefined && reply.origin !== origin)
					)
						throw changed();
					resolve({ value: reply, expected: { ...expected, origin: canonicalOrigin(reply.origin) } });
				})
				.catch(reject)
				.finally(() => combined.removeEventListener('abort', abort));
		});
	};
	const negotiate = async (signal: AbortSignal): Promise<ContextReply> => {
		const { value, expected } = await send({ action: 'context' }, signal);
		const capabilities = { ...value.capabilities, platform: 'macos' } as FolderCapabilities;
		const manifest = value.apiCapabilities;
		if (
			!supportsFolderAccess(capabilities) ||
			manifest?.schemaVersion !== 1 ||
			manifest.origin !== expected.origin ||
			!manifest.features ||
			typeof manifest.features !== 'object' ||
			Array.isArray(manifest.features)
		)
			throw changed();
		const parsed = supportsNativeAuthorizationContext(capabilities)
			? parseMobileFolderResult({ type: 'mobile-files-result', payload: value }, expected, { action: 'conditions' }) : undefined;
		return { origin: expected.origin, capabilities, apiCapabilities: structuredClone(manifest),
			...(parsed ? { authorization: { roots: parsed.roots, conditions: parsed.conditions! } } : {}) };
	};
	let context = await negotiate(input.signal);
	origin = context.origin;
	if (input.resourcePolicy && !supportsNativeResourceLimits(context.capabilities)) throw Error('Update Thingtime before using sync resource limits.');
	const fetchBound = createFolderHostFetch({ origin, localOrigin, ownerId, signal: input.signal, check,
		fetch: input.fetch ?? ((target, options) => window.fetch(target, options)) });
	return {
		origin: () => {
			check();
			return origin!;
		},
		capabilities: context.capabilities,
		assertCurrent: check,
		fetch: fetchBound,
		...(supportsNativeUploadBatches(context.capabilities) && capabilitySatisfies(context.apiCapabilities.features['api.file-sync-batches']?.version, '1.0.0') ? {
			uploadBatch: async (batch: import('./uploadBatch').NativeUploadBatchInput, _callbacks: import('./uploadBatch').NativeUploadBatchCallbacks, signal: AbortSignal) => {
				check();
				if (batch.descriptor.scope.ownerId !== ownerId || batch.descriptor.scope.deviceId !== deviceId || batch.descriptor.scope.origin !== origin)
					throw changed();
				const request: FolderRequest = { action: 'upload-batch', rootId: batch.descriptor.configuration.configuration.localRootId, batch };
				const { value, expected } = await send(request, signal);
				const result = parseMobileFolderResult({ type: 'mobile-files-result', payload: value }, expected, request);
				if (!result?.uploadedBatch) throw changed();
				if (result.resources) input.resourcePolicy?.observe(result.resources);
				return result.uploadedBatch;
			}
		} : {}),
		...(supportsNativeFolderBatches(context.capabilities) && capabilitySatisfies(context.apiCapabilities.features['api.file-sync-batches']?.version, '1.1.0') ? {
			folderBatch: async (value: import('./folderBatch').NativeFolderBatchInput, signal: AbortSignal) => {
				check();
				if (value.descriptor.scope.ownerId !== ownerId || value.descriptor.scope.deviceId !== deviceId || value.descriptor.scope.origin !== origin) throw changed();
				const { remainingMs, ...batch } = value;
				const request: FolderRequest = { action: 'validate-folder-batch', rootId: batch.descriptor.configuration.configuration.localRootId, batch, remainingMs };
				const { value: reply, expected } = await send(request, signal);
				const parsed = parseMobileFolderResult({ type: 'mobile-files-result', payload: reply }, expected, request);
				if (!parsed?.validatedFolderBatch) throw changed();
				if (parsed.resources) input.resourcePolicy?.observe(parsed.resources);
				return parsed.validatedFolderBatch;
			}
		} : {}),
		request: async (expectedOwner, request, signal) => {
			if (expectedOwner !== ownerId) throw changed();
			assertNativeScanExclusions(request, context.capabilities);
			if (['scan-capture', 'scan-page', 'scan-discard'].includes(request.action) && !supportsNativeInventoryPages(context.capabilities))
				throw Error('Inventory pages require an updated Mac app.');
			if (request.action === 'validate-folder-batch' && (!supportsNativeFolderBatches(context.capabilities) || !capabilitySatisfies(context.apiCapabilities.features['api.file-sync-batches']?.version, '1.1.0'))) throw Error('Folder metadata batches require a compatible native host and server.');
			if (request.action === 'inspect' && !supportsNativePathInspection(context.capabilities)) throw Error('Update Thingtime Desktop to inspect individual sync paths.');
			if (request.action === 'upload-batch' && (!supportsNativeUploadBatches(context.capabilities) ||
				!capabilitySatisfies(context.apiCapabilities.features['api.file-sync-batches']?.version, '1.0.0')))
				throw Error('Native upload batches require a compatible desktop host and selected server.');
			const payload = structuredClone(request);
			const { value, expected } = await send(payload, signal);
			const result = parseMobileFolderResult({ type: 'mobile-files-result', payload: value }, expected, payload);
			if (!result) throw changed();
			if (result.resources) input.resourcePolicy?.observe(result.resources);
			return result;
		},
		...(supportsNativeAuthorizationContext(context.capabilities) ? {
			authorizeContext: async (expectedOwner: string, expectedDevice: string, signal: AbortSignal) => {
				if (expectedOwner !== ownerId || expectedDevice !== deviceId) throw changed();
				const next = await negotiate(signal);
				if (JSON.stringify(next.capabilities) !== JSON.stringify(context.capabilities) || !next.authorization) throw changed();
				context = next;
				return structuredClone(next.authorization);
			}
		} : {}),
		authorizeDevice: async (expectedOwner, expectedDevice, signal) => {
			if (expectedOwner !== ownerId || expectedDevice !== deviceId) throw changed();
			const next = await negotiate(signal);
			if (JSON.stringify(next.capabilities) !== JSON.stringify(context.capabilities)) throw changed();
			context = next;
		},
		requireCapability: async (feature, minimumVersion) => {
			check();
			const version = context.apiCapabilities.features[feature]?.version;
			if (typeof version !== 'string' || !capabilitySatisfies(version, minimumVersion))
				throw Error(`Thingtime capability ${feature} is incompatible`);
		}
	};
}
