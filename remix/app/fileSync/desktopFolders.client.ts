import type { ThingtimeDesktopBridge } from '../utils/electronBridge';
import { capabilitySatisfies } from '../api/utils/capabilities/capabilityContract';
import {
	parseMobileFolderResult,
	supportsFolderAccess,
	type FolderCapabilities,
	type FolderRequest,
	type FolderResult
} from './mobileFolders.client';

export type FolderHost = {
	origin(): string;
	capabilities: FolderCapabilities | undefined;
	request(ownerId: string, request: FolderRequest, signal: AbortSignal): Promise<FolderResult>;
	authorizeDevice(ownerId: string, deviceId: string, signal: AbortSignal): Promise<void>;
	fetch: typeof fetch;
	requireCapability(feature: string, minimumVersion: string): Promise<void>;
	assertCurrent(): void;
};
type ContextReply = {
	origin: string;
	capabilities: FolderCapabilities;
	apiCapabilities: { schemaVersion: 1; origin: string; features: Record<string, { version: string }> };
};
const queues = new WeakMap<object, Promise<unknown>>();
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
			const queued = (queues.get(input.bridge) ?? Promise.resolve())
				.catch(() => {})
				.then(() => {
					combined.throwIfAborted();
					check();
					dispatched = true;
					return invoke({ ...expected, ...payload });
				});
			queues.set(
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
		return { origin: expected.origin, capabilities, apiCapabilities: structuredClone(manifest) };
	};
	let context = await negotiate(input.signal);
	origin = context.origin;
	const fetcher = input.fetch ?? fetch;
	const fetchBound: typeof fetch = async (target, init) => {
		check();
		// Shared transports only pass URLs with explicit options. Refuse Request
		// objects rather than accidentally dropping their method, body or signal.
		if (typeof target !== 'string' && !(target instanceof URL)) throw changed();
		const url = new URL(target),
			headers = new Headers(init?.headers);
		if (url.username || url.password || url.hash) throw changed();
		const signed = init?.credentials === 'omit';
		if (signed) {
			if (
				(url.protocol !== 'https:' && url.origin !== origin) ||
				init?.redirect !== 'error' ||
				['authorization', 'cookie', 'x-thingtime-expected-actor', 'x-thingtime-expected-data-plane', 'x-thingtime-expected-api-origin'].some((key) =>
					headers.has(key)
				)
			)
				throw changed();
		} else if (
			url.origin !== origin ||
			!url.pathname.startsWith('/api/v1/') ||
			!['same-origin', 'include'].includes(init?.credentials ?? '') ||
			init?.redirect !== 'error' ||
			init?.cache !== 'no-store' ||
			headers.get('X-Thingtime-Expected-Actor') !== ownerId ||
			headers.get('X-Thingtime-Expected-Data-Plane') !== 'home' ||
			headers.has('authorization') ||
			headers.has('cookie')
		)
			throw changed();
		if (!signed) headers.set('X-Thingtime-Expected-Api-Origin', origin!);
		const destination = signed ? url : new URL(url.pathname + url.search, localOrigin);
		const signal = init?.signal ? AbortSignal.any([input.signal, init.signal]) : input.signal;
		signal.throwIfAborted();
		const response = await fetcher(destination, { ...init, headers, signal });
		try {
			check();
			signal.throwIfAborted();
			if (response.redirected || (!signed && origin !== localOrigin && response.headers.get('x-thingtime-api-fallback') !== origin)) throw changed();
			return response;
		} catch (error) {
			await response.body?.cancel().catch(() => {});
			throw error;
		}
	};
	return {
		origin: () => {
			check();
			return origin!;
		},
		capabilities: context.capabilities,
		assertCurrent: check,
		fetch: fetchBound,
		request: async (expectedOwner, request, signal) => {
			if (expectedOwner !== ownerId) throw changed();
			const payload = structuredClone(request);
			const { value, expected } = await send(payload, signal);
			const result = parseMobileFolderResult({ type: 'mobile-files-result', payload: value }, expected, payload);
			if (!result) throw changed();
			return result;
		},
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
