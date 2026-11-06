import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '~/utils/nativeBridge';
export type MobileLocationStatus = {
	enabled: boolean;
	authorization: 'always' | 'when-in-use' | 'denied' | 'restricted' | 'not-requested';
	precision: 'precise' | 'approximate';
	backgroundAvailable: boolean;
	collectionMode: 'significant-change';
	notificationAuthorization?: 'allowed' | 'quiet' | 'denied' | 'not-requested';
};
export type MobileLocationAction = 'status' | 'enable' | 'disable' | 'request-permission' | 'open-settings' | 'request-notification-permission';
export const supportsMobileLocation = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()) =>
	Boolean(bridge?.isNativeWebView && bridge.platform === 'ios' && /^1\.\d+\.\d+$/.test(bridge.deviceLocationVersion ?? ''));
export function parseMobileLocationResult(
	value: unknown,
	expected: { requestId: string; ownerId: string; origin: string }
): MobileLocationStatus | null {
	if (!value || typeof value !== 'object') return null;
	const envelope = value as { type?: string; payload?: Record<string, unknown> },
		result = envelope.payload;
	if (
		envelope.type !== 'mobile-device-location-result' ||
		!result ||
		result.requestId !== expected.requestId ||
		result.ownerId !== expected.ownerId ||
		result.origin !== expected.origin
	)
		return null;
	if (typeof result.error === 'string') throw new Error(result.error.slice(0, 240));
	if (
		typeof result.enabled !== 'boolean' ||
		typeof result.backgroundAvailable !== 'boolean' ||
		result.collectionMode !== 'significant-change' ||
		!['always', 'when-in-use', 'denied', 'restricted', 'not-requested'].includes(String(result.authorization)) ||
		!['precise', 'approximate'].includes(String(result.precision))
	)
		throw new Error('Invalid native location response.');
	return {
		enabled: result.enabled,
		authorization: result.authorization as MobileLocationStatus['authorization'],
		precision: result.precision as MobileLocationStatus['precision'],
		backgroundAvailable: result.backgroundAvailable,
		collectionMode: 'significant-change',
		...(['allowed', 'quiet', 'denied', 'not-requested'].includes(String(result.notificationAuthorization))
			? { notificationAuthorization: result.notificationAuthorization as MobileLocationStatus['notificationAuthorization'] } : {})
	};
}
let queue: Promise<unknown> = Promise.resolve();
export function requestMobileLocation(
	ownerId: string,
	action: MobileLocationAction,
	signal: AbortSignal,
	options: { collectionId?: string; always?: boolean } = {}
): Promise<MobileLocationStatus> {
	const bridge = getNativeBridge();
	if (!supportsMobileLocation(bridge)) return Promise.reject(new Error('Location collection requires a compatible Thingtime iOS app.'));
	if (signal.aborted) return Promise.reject(new DOMException('Location request cancelled', 'AbortError'));
	if (action === 'enable' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.collectionId || ''))
		return Promise.reject(new Error('Enable the server collection policy before starting location collection.'));
	const origin = window.location.origin;
	const run = queue.then(() => {
		signal.throwIfAborted();
		if (getNativeBridge() !== bridge || window.location.origin !== origin) throw new DOMException('Location scope changed', 'AbortError');
		const expected = { requestId: crypto.randomUUID(), ownerId, origin };
		return new Promise<MobileLocationStatus>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer);
				window.removeEventListener(nativeBridgeMessageEvent, listener);
				signal.removeEventListener('abort', abort);
			};
			const abort = () => {
				cleanup();
				reject(new DOMException('Location request cancelled', 'AbortError'));
			};
			const listener = (event: Event) => {
				try {
					const next = parseMobileLocationResult((event as CustomEvent).detail, expected);
					if (next) {
						cleanup();
						resolve(next);
					}
				} catch (error) {
					cleanup();
					reject(error);
				}
			};
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error('Location request timed out. Check the current permission status before retrying.'));
			}, 30_000);
			window.addEventListener(nativeBridgeMessageEvent, listener);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
				return;
			}
			try {
				bridge!.postMessage({
					type: 'mobile-device-location',
					payload: {
						...expected,
						action,
						...(action === 'enable' ? { collectionId: options.collectionId } : {}),
						...(action === 'request-permission' ? { always: options.always === true } : {})
					}
				});
			} catch (error) {
				cleanup();
				reject(error);
			}
		});
	});
	queue = run.catch(() => {});
	return new Promise((resolve, reject) => {
		const abort = () => reject(new DOMException('Location request cancelled', 'AbortError'));
		signal.addEventListener('abort', abort, { once: true });
		run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}
