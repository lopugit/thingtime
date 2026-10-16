import { getNativeBridge, nativeBridgeMessageEvent, type ThingtimeNativeBridge } from '~/utils/nativeBridge';

export type MobileDeviceStatus = { state: 'unpaired' | 'pending' | 'paired' | 'revoked'; deviceId?: string };
export const supportsMobileDevice = (bridge: ThingtimeNativeBridge | undefined = getNativeBridge()): boolean =>
	Boolean(bridge?.isNativeWebView && ['ios', 'android'].includes(bridge.platform) && /^1\.\d+\.\d+$/.test(bridge.devicePairingVersion ?? ''));

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

export function requestMobileDevice(ownerId: string, action: 'status' | 'pair', signal: AbortSignal): Promise<MobileDeviceStatus> {
	const bridge = getNativeBridge();
	if (!supportsMobileDevice(bridge)) return Promise.reject(new Error('Mobile device pairing requires an updated Thingtime app.'));
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
		try { bridge!.postMessage({ type: 'mobile-device', payload: { ...expected, action } }); }
		catch (error) { cleanup(); reject(error); }
	});
}
