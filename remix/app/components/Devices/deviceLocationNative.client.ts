import { requestMobileDevice } from './mobileDeviceBridge';
import { requestMobileLocation, supportsMobileLocation, type MobileLocationAction } from './mobileDeviceLocationBridge';
import type { DeviceLocationScope } from './deviceLocation.client';

type DesktopLocationBridge = {
	deviceLocationVersion?: string;
	deviceLocationRequest?: (request: { action: string; ownerId: string; deviceId: string; enabled?: boolean }) => Promise<unknown>;
};
const desktop = (): DesktopLocationBridge | undefined => typeof window === 'undefined' ? undefined : (window as unknown as { thingtimeDesktop?: DesktopLocationBridge }).thingtimeDesktop;
export type DeviceNativeLocationStatus = { enabled: boolean; authorization: string; precision: string | null; backgroundAvailable: boolean; collectionMode: string; notificationAuthorization?: string };
export function supportsDeviceLocationNative() {
	const bridge = desktop();
	return supportsMobileLocation() || !!(bridge?.deviceLocationRequest && /^1\.\d+\.\d+$/.test(bridge.deviceLocationVersion || ''));
}
export async function requestDeviceLocationNative(scope: DeviceLocationScope, action: MobileLocationAction | 'request-notification-permission', signal: AbortSignal, options: { always?: boolean; collectionId?: string } = {}): Promise<DeviceNativeLocationStatus> {
	signal.throwIfAborted();
	if (window.location.origin !== scope.origin) throw new Error('Device origin changed.');
	if (supportsMobileLocation()) {
		const identity = await requestMobileDevice(scope.ownerId, 'status', signal);
		if (identity.state !== 'paired' || identity.deviceId !== scope.deviceId) throw new Error('Open this device’s Thingtime app to change its location permission or collection.');
		return requestMobileLocation(scope.ownerId, action, signal, options);
	}
	const bridge = desktop();
	if (!bridge?.deviceLocationRequest || !/^1\.\d+\.\d+$/.test(bridge.deviceLocationVersion || '')) throw new Error('Location collection requires a compatible Thingtime native app.');
	const value = await bridge.deviceLocationRequest({ action: action === 'enable' || action === 'disable' ? 'set-enabled' : action, ownerId: scope.ownerId, deviceId: scope.deviceId, ...(action === 'enable' || action === 'disable' ? { enabled: action === 'enable' } : {}) });
	signal.throwIfAborted();
	if (desktop() !== bridge || window.location.origin !== scope.origin) throw new Error('Device scope changed.');
	const result = value as { enabled?: unknown; authorization?: unknown; servicesEnabled?: unknown };
	if (typeof result?.enabled !== 'boolean' || typeof result.servicesEnabled !== 'boolean' || !['granted', 'notDetermined', 'denied', 'restricted', 'unknown'].includes(String(result.authorization))) throw new Error('Invalid native location response.');
	return { enabled: result.enabled, authorization: String(result.authorization), precision: null, backgroundAvailable: result.servicesEnabled && result.authorization === 'granted', collectionMode: 'standard' };
}
