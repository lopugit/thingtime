/** Shared wire vocabulary; a platform never grants device capabilities. */
export const DEVICE_PLATFORMS = ['macos', 'windows', 'linux', 'watchos', 'ios', 'android'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const isDevicePlatform = (value: unknown): value is DevicePlatform =>
	typeof value === 'string' && (DEVICE_PLATFORMS as readonly string[]).includes(value);

/** Mobile clients must negotiate these before starting a pairing claim. */
export const MOBILE_DEVICE_REQUIREMENTS = {
	'api.devices': '1.13.0',
	'api.devices-pairing': '1.0.0',
	'api.devices-pairing-claim': '1.2.0',
	'api.devices-node-state': '1.9.0'
} as const;
