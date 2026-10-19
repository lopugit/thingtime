import { getElectronBridge } from '../utils/electronBridge';
import { getNativeBridge } from '../utils/nativeBridge';
import { requestMobileDevice, supportsMobileDevice } from '../components/Devices/mobileDeviceBridge';
import { createThingtimeCapabilityChecker } from '../api/utils/capabilities/requireCapability.client';
import { requestMobileFolders, supportsNativeWriteApprovalCheck } from './mobileFolders.client';
import { createDesktopFolderHost, type FolderHost } from './desktopFolders.client';
import { createFolderHostFetch } from './folderHostFetch.client';

export function getNativeSyncAdapter() {
	const desktop = getElectronBridge();
	if (desktop?.platform === 'darwin' && desktop.folderSyncTaskVersion === '1.0.0' && desktop.setFolderSyncActive && desktop.folderSyncRequest)
		return { platform: 'macos' as const, bridge: desktop };
	const mobile = getNativeBridge();
	if (mobile?.platform === 'ios' && supportsMobileDevice(mobile) && supportsNativeWriteApprovalCheck(mobile))
		return { platform: 'ios' as const, bridge: mobile };
	return undefined;
}
export type NativeSyncAdapter = NonNullable<ReturnType<typeof getNativeSyncAdapter>>;
export function isNativeSyncAdapterCurrent(adapter: NativeSyncAdapter) {
	const current = getNativeSyncAdapter();
	return current?.platform === adapter.platform && current.bridge === adapter.bridge;
}

/** Uses the current native session, never a copied credential or a UI lifetime.
 * iOS is pinned to its WebView origin; the Mac adapter verifies its selected API. */
export async function createNativeSyncHost(input: {
	adapter: NativeSyncAdapter; ownerId: string; deviceId: string; signal: AbortSignal; assertCurrent(): void;
}): Promise<FolderHost> {
	const origin = window.location.origin;
	const check = () => {
		input.signal.throwIfAborted(); input.assertCurrent();
		if (window.location.origin !== origin || !isNativeSyncAdapterCurrent(input.adapter))
			throw Error('The account, device or sync server changed. Reopen folder access.');
	};
	check();
	if (input.adapter.platform === 'macos') return createDesktopFolderHost({ ...input, bridge: input.adapter.bridge,
		rendererOrigin: () => window.location.origin, assertCurrent: check });
	const authorizeDevice: FolderHost['authorizeDevice'] = async (ownerId, deviceId, signal) => {
		check();
		if (ownerId !== input.ownerId || deviceId !== input.deviceId) throw Error('The sync device changed.');
		const combined = AbortSignal.any([input.signal, signal]); combined.throwIfAborted();
		const status = await requestMobileDevice(ownerId, 'status', combined);
		check(); combined.throwIfAborted();
		if (status.state !== 'paired' || status.deviceId !== deviceId) throw Error('Reconnect this device before transferring files.');
	};
	await authorizeDevice(input.ownerId, input.deviceId, input.signal);
	const requireCapability = createThingtimeCapabilityChecker();
	return {
		origin: () => { check(); return origin; },
		capabilities: input.adapter.bridge,
		assertCurrent: check,
		authorizeDevice,
		fetch: createFolderHostFetch({ origin, localOrigin: origin, ownerId: input.ownerId, signal: input.signal, check,
			fetch: (target, options) => window.fetch(target, options) }),
		requireCapability: async (feature, minimum) => { check(); await requireCapability(feature, minimum); check(); },
		request: async (ownerId, request, signal, progress, background) => {
			check();
			if (ownerId !== input.ownerId) throw Error('The sync account changed.');
			const combined = AbortSignal.any([input.signal, signal]); combined.throwIfAborted();
			const result = await requestMobileFolders(ownerId, request, combined, progress, background);
			check(); combined.throwIfAborted(); return result;
		}
	};
}
