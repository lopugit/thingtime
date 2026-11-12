import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '~/utils/nativeBridge';

export type MobileDeviceStatus = { state: 'unpaired' | 'pending' | 'paired' | 'revoked'; deviceId?: string };
export const supportsMobileDevice = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()): boolean =>
	Boolean(bridge?.isNativeWebView && ['ios', 'android'].includes(bridge.platform) && /^1\.\d+\.\d+$/.test(bridge.devicePairingVersion ?? ''));

export const supportsMobileBackgroundPresence = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()): boolean =>
	Boolean(supportsMobileDevice(bridge) && bridge?.platform === 'ios' && Number(bridge.devicePairingVersion?.split('.')[1]) >= 1);

export function requestMobileDevicePresence(ownerId: string, signal: AbortSignal): Promise<MobileDeviceStatus> {
	return requestMobileDevice(ownerId, supportsMobileBackgroundPresence() ? 'presence' : 'status', signal);
}

/** Identity/preference cleanup must not wait behind a suspended network request.
 * The host only clears this owner's approved scope; ordinary visibility changes
 * continue to use request-scoped suspend without withdrawing background access. */
export function stopMobileBackgroundPresence(ownerId: string, origin: string): void {
	const bridge = getNativeBridge();
	if (!supportsMobileBackgroundPresence(bridge) || window.location.origin !== origin) return;
	try {
		bridge!.postMessage({ type: 'mobile-device', payload: { requestId: crypto.randomUUID(), ownerId, origin, action: 'presence', enabled: false } });
	} catch { /* Native navigation and foreground transitions independently invalidate the scope. */ }
}

export function parseMobileDeviceResult(value: unknown, expected: { requestId: string; ownerId: string; origin: string }): MobileDeviceStatus | null {
	if (!value || typeof value !== 'object') return null;
	const envelope = value as { type?: string; payload?: Record<string, unknown> };
	const result = envelope.payload;
	if (envelope.type !== 'mobile-device-result' || !result || result.requestId !== expected.requestId || result.ownerId !== expected.ownerId || result.origin !== expected.origin) return null;
	if (typeof result.error === 'string') throw new Error(result.error.slice(0, 240));
	if (!['unpaired', 'pending', 'paired', 'revoked'].includes(String(result.state))) throw new Error('Invalid native device response');
	if (result.state === 'paired' && (typeof result.deviceId !== 'string' || !result.deviceId || result.deviceId.length > 512)) throw new Error('Missing native device identity');
	return { state: result.state as MobileDeviceStatus['state'], ...(result.state === 'paired' ? { deviceId: result.deviceId as string } : {}) };
}

// The native controller intentionally handles one pairing operation at a time.
// Serialize UI polling and foreground checks without sharing results across
// callers or letting one caller cancel another caller's identity check.
let deviceRequests: Promise<unknown> = Promise.resolve();
export function requestMobileDevice(ownerId: string, action: 'status' | 'pair' | 'presence', signal: AbortSignal,
    binding?: { expectedDeviceId: string; assertCurrent(): void }): Promise<MobileDeviceStatus> {
    if (signal.aborted) return Promise.reject(new DOMException('Device request cancelled', 'AbortError'));
    const bridge = getNativeBridge();
    if (!supportsMobileDevice(bridge)) return Promise.reject(new Error('Mobile device pairing requires an updated Thingtime app.'));
    if (action === 'presence' && !supportsMobileBackgroundPresence(bridge)) return Promise.reject(new Error('Background presence requires an updated Thingtime iOS app.'));
    const origin = window.location.origin;
    const check = () => {
        if (signal.aborted || window.location.origin !== origin || getNativeBridge() !== bridge)
            throw new DOMException('Device request cancelled', 'AbortError');
        binding?.assertCurrent();
    };
    const run = deviceRequests.then(async () => {
        check();
        const result = await requestMobileDeviceNow(ownerId, action, signal);
        check();
        if (binding && result.state === 'paired' && result.deviceId !== binding.expectedDeviceId)
            throw Error('Reconnect this device before transferring files.');
        return result;
    });
    deviceRequests = run.catch(() => {});
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Device request cancelled', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        run.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

function requestMobileDeviceNow(ownerId: string, action: 'status' | 'pair' | 'presence', signal: AbortSignal): Promise<MobileDeviceStatus> {
	const bridge = getNativeBridge();
	if (!supportsMobileDevice(bridge)) return Promise.reject(new Error('Mobile device pairing requires an updated Thingtime app.'));
	if (action === 'presence' && !supportsMobileBackgroundPresence(bridge)) return Promise.reject(new Error('Background presence requires an updated Thingtime iOS app.'));
	const expected = { requestId: crypto.randomUUID(), ownerId, origin: window.location.origin };
	return new Promise((resolve, reject) => {
		const cleanup = () => { clearTimeout(timer); window.removeEventListener(nativeBridgeMessageEvent, listener); signal.removeEventListener('abort', abort); };
		const abort = () => {
			cleanup();
			try { bridge!.postMessage({ type: 'mobile-device', payload: { ...expected, action: 'suspend' } }); } catch { /* The view still releases its own wait. */ }
			reject(new DOMException('Device request cancelled', 'AbortError'));
		};
		const listener = (event: Event) => {
			try {
				const result = parseMobileDeviceResult((event as CustomEvent).detail, expected);
				if (result) { cleanup(); resolve(result); }
			} catch (error) { cleanup(); reject(error); }
		};
		const timer = setTimeout(() => {
            cleanup();
            try { bridge!.postMessage({ type: 'mobile-device', payload: { ...expected, action: 'suspend' } }); } catch { /* The view still releases its own wait. */ }
            reject(new Error('The device request timed out. Retry to resume saved pairing.'));
        }, 120_000);
		window.addEventListener(nativeBridgeMessageEvent, listener);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) { abort(); return; }
		try { bridge!.postMessage({ type: 'mobile-device', payload: { ...expected, action, ...(action === 'presence' ? { enabled: true } : {}) } }); }
		catch (error) { cleanup(); reject(error); }
	});
}
