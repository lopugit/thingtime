import { supportsMobileDevice, type MobileDeviceStatus } from './mobileDeviceBridge';
import { nativeBridgeReadyEvent, type ThingtimeNativeBridge } from '../../utils/nativeBridge';

type PresenceEnvironment = {
	window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
	document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
	current(): boolean;
	bridge(): ThingtimeNativeBridge | undefined;
	request(signal: AbortSignal): Promise<MobileDeviceStatus>;
	schedule(callback: () => void, delay: number): () => void;
};

/** Presence belongs to the signed-in shell, independently of routes and file-sync jobs.
 * Only native status is requested: saved/revoked pairings are never recreated. */
export function startMobileDevicePresence(environment: PresenceEnvironment) {
	let disposed = false;
	let pending: AbortController | undefined;
	let pendingBridge: ThingtimeNativeBridge | undefined;
	let cancelTimer: (() => void) | undefined;
	let failures = 0;
	const cancel = () => {
		cancelTimer?.();
		cancelTimer = undefined;
		pending?.abort();
		pending = undefined;
		pendingBridge = undefined;
	};
	const refresh = () => {
		if (disposed) return;
		if (!environment.current() || environment.document.visibilityState !== 'visible') {
			cancel();
			return;
		}
		const bridge = environment.bridge();
		if (pending && pendingBridge === bridge) return;
		cancel();
		if (!supportsMobileDevice(bridge)) return;
		const controller = new AbortController();
		pending = controller;
		pendingBridge = bridge;
		void environment
			.request(controller.signal)
			.then(
				() => {
					if (pending === controller && !controller.signal.aborted) failures = 0;
				},
				() => {
					if (pending === controller && !controller.signal.aborted) failures = Math.min(failures + 1, 3);
				}
			)
			.finally(() => {
				if (pending !== controller) return;
				pending = undefined;
				pendingBridge = undefined;
				if (!disposed && environment.current() && environment.document.visibilityState === 'visible')
					cancelTimer = environment.schedule(refresh, 30_000 * 2 ** Math.max(0, failures - 1));
			});
	};
	const events = ['focus', 'pageshow', 'online', nativeBridgeReadyEvent];
	for (const name of events) environment.window.addEventListener(name, refresh);
	environment.document.addEventListener('visibilitychange', refresh);
	// StrictMode's discarded mount must not own a native request.
	cancelTimer = environment.schedule(refresh, 0);
	return {
		refresh,
		stop() {
			disposed = true;
			cancel();
			for (const name of events) environment.window.removeEventListener(name, refresh);
			environment.document.removeEventListener('visibilitychange', refresh);
		}
	};
}
