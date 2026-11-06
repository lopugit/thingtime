import type { MobileDeviceStatus } from './mobileDeviceBridge';

const observations = new Map<string, MobileDeviceStatus>();
const listeners = new Map<string, Set<(status: MobileDeviceStatus) => void>>();
export const mobileDeviceScope = (origin: string, ownerId: string) => `${origin}:${ownerId}`;
export const readMobileDeviceObservation = (scope: string) => observations.get(scope);
export function observeMobileDevice(scope: string, listener: (status: MobileDeviceStatus) => void) {
	const scoped = listeners.get(scope) ?? new Set();
	scoped.add(listener);
	listeners.set(scope, scoped);
	return () => {
		scoped.delete(listener);
		if (!scoped.size) listeners.delete(scope);
	};
}
export function publishMobileDeviceObservation(scope: string, status: MobileDeviceStatus) {
	observations.set(scope, status);
	if (observations.size > 32) observations.delete(observations.keys().next().value!);
	for (const listener of listeners.get(scope) ?? []) listener(status);
}
