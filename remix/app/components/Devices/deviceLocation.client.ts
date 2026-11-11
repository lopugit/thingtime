import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
export type DeviceLocationObservation = {
	id: string;
	deviceId: string;
	type: 'location';
	observedAt: string;
	receivedAt: string;
	value: { latitude: number; longitude: number; accuracyMeters: number; precision?: string; source?: string };
};
export type DeviceLocationSettings = { enabled: boolean; retentionMs: number | null; collectionId: string | null };
export type DeviceLocationPage = {
	observations: DeviceLocationObservation[];
	latest: DeviceLocationObservation | null;
	settings: DeviceLocationSettings;
	nextCursor: string | null;
};
export type DeviceLocationScope = { origin: string; ownerId: string; deviceId: string };
export async function deviceLocationRequest(
	scope: DeviceLocationScope,
	path: string,
	signal: AbortSignal,
	body?: Record<string, unknown>
): Promise<Record<string, any>> {
	if (window.location.origin !== scope.origin) throw new Error('Device origin changed.');
	await requireThingtimeCapability(body ? 'api.devices-observation-settings' : 'api.devices-observations', '1.0.0', scope.origin);
	signal.throwIfAborted();
	const response = await fetch(scope.origin + path, {
		method: body ? 'POST' : 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		redirect: 'error',
		signal,
		headers: { 'X-Thingtime-Expected-Actor': scope.ownerId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
		...(body ? { body: JSON.stringify(body) } : {})
	});
	const result = await response.json();
	if (!response.ok || result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Device location is unavailable.');
	return result;
}
export async function readDeviceLocations(
	scope: DeviceLocationScope,
	signal: AbortSignal,
	options: { cursor?: string; from?: string; to?: string } = {}
): Promise<DeviceLocationPage> {
	const query = new URLSearchParams({ deviceId: scope.deviceId, type: 'location', ...options });
	return (await deviceLocationRequest(scope, '/api/v1/devices/observations?' + query, signal)) as DeviceLocationPage;
}
export async function saveDeviceLocationSettings(
	scope: DeviceLocationScope,
	signal: AbortSignal,
	settings: Partial<Pick<DeviceLocationSettings, 'enabled' | 'retentionMs'>>
) {
	return (await deviceLocationRequest(scope, '/api/v1/devices/observation-settings', signal, {
		deviceId: scope.deviceId,
		type: 'location',
		...settings
	})) as { settings: DeviceLocationSettings; cleanup: { deleted: number; hasMore: boolean } };
}
/** Display projections preserve API coordinates/timestamps; color is redundant with age labels. */
export function deviceLocationPoints(observations: DeviceLocationObservation[], latestId: string | undefined, now = Date.now()) {
	return observations.flatMap((observation) => {
		const { latitude, longitude } = observation.value,
			at = Date.parse(observation.observedAt);
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || !Number.isFinite(at))
			return [];
		const age = Math.max(0, now - at),
			ageBand = age < 3600000 ? 'Recent' : age < 86400000 ? 'Today' : 'Earlier';
		return [
			{
				id: observation.id,
				coordinates: [longitude, latitude],
				label: `${observation.id === latestId ? 'Latest · ' : ''}${new Date(at).toLocaleString()} · ${ageBand}`,
				color: ageBand === 'Recent' ? '#0f766e' : ageBand === 'Today' ? '#2563eb' : '#7c3aed',
				selected: observation.id === latestId,
				observedAt: observation.observedAt,
				accuracyMeters: observation.value.accuracyMeters,
				precision: observation.value.precision ?? 'unknown',
				ageBand,
				latest: observation.id === latestId
			}
		];
	});
}
