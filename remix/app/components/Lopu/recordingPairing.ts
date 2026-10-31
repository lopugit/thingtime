import { supportsPersonalRecordingSettings } from './recordingsCapabilities';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';

export const RECORDING_PAIRING_REQUIREMENTS = { 'api.devices-pairing': '1.1.0', 'api.devices-pairing-claim': '1.0.0' } as const;
export type RecordingPairingChallenge = { secret: string; expiresAt: number };
export const supportsRecordingPairing = (manifest: any, origin: string) =>
	manifest?.schemaVersion === 1 && supportsPersonalRecordingSettings(manifest, origin) &&
	Object.entries(RECORDING_PAIRING_REQUIREMENTS).every(([id, minimum]) => capabilitySatisfies(manifest.features?.[id]?.version, minimum)) &&
	Array.isArray(manifest.operations) && manifest.operations.some((operation: any) =>
		operation.feature === 'api.devices-pairing' && operation.path === '/api/v1/devices/pairing' && operation.methods?.includes('POST'));

export const parseRecordingPairingChallenge = (value: any, ownerId: string, now = Date.now()): RecordingPairingChallenge => {
	const expiresAt = typeof value?.pairing?.expiresAt === 'string' ? Date.parse(value.pairing.expiresAt) : NaN;
	if (value?.ok !== true || value.ownerId !== ownerId || !/^ttpair_[A-Za-z0-9_-]{43}$/.test(value.pairing?.pairingSecret || '') ||
		!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + 11 * 60_000)
		throw new Error('The pairing challenge expired or belongs to a different account. Please try again.');
	return { secret: value.pairing.pairingSecret, expiresAt };
};

export const requestRecordingPairing = async (options: { origin: string; ownerId: string; signal: AbortSignal; fetcher?: typeof fetch }) => {
	const fetcher = options.fetcher || fetch;
	const request = async (path: string, post = false) => {
		const response = await fetcher(new URL(path, options.origin), { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: options.signal,
			...(post ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) });
		if (!response.ok) { await response.body?.cancel(); throw new Error('Pairing could not be started. Check your connection and sign-in, then try again.'); }
		return response.json();
	};
	if (!supportsRecordingPairing(await request('/.well-known/thingtime-capabilities.json'), options.origin))
		throw new Error('This Thingtime domain needs the recording pairing update before setup is available.');
	options.signal.throwIfAborted();
	return parseRecordingPairingChallenge(await request('/api/v1/devices/pairing', true), options.ownerId);
};
