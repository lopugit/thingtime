import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';

import { createDeviceRuntimeState, projectDeviceStateForCache } from './deviceCore';
import type { DeviceRuntimeState, DeviceSummary } from './deviceTypes';

export const DEVICE_CACHE_VERSION = 1;
export const MAX_CACHED_DEVICES = 16;

type DeviceListCacheEnvelope = {
	version: typeof DEVICE_CACHE_VERSION;
	writtenAt: string;
	devices: DeviceSummary[];
};

type DeviceDetailCacheEnvelope = {
	version: typeof DEVICE_CACHE_VERSION;
	writtenAt: string;
	state: DeviceRuntimeState;
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const cacheToken = (value: string | null | undefined): string =>
	encodeURIComponent((typeof value === 'string' && value.trim() ? value.trim() : 'anonymous').slice(0, 180));

export const deviceListCacheKey = (userId: string | null | undefined): string => `tt-devices:${cacheToken(userId)}`;

export const deviceDetailCacheKey = (userId: string | null | undefined, deviceId: string): string =>
	`tt-device:${cacheToken(userId)}:${cacheToken(deviceId)}`;

const isSummaryLike = (value: unknown): value is DeviceSummary =>
	record(value) &&
	typeof value.id === 'string' &&
	typeof value.name === 'string' &&
	typeof value.platform === 'string' &&
	typeof value.revision === 'number' &&
	Array.isArray(value.capabilities);

const isRuntimeStateLike = (value: unknown): value is DeviceRuntimeState =>
	record(value) &&
	typeof value.deviceId === 'string' &&
	(value.summary === null || isSummaryLike(value.summary)) &&
	(value.snapshot === null || record(value.snapshot)) &&
	Array.isArray(value.commands) &&
	Array.isArray(value.approvals) &&
	Array.isArray(value.agentSessions) &&
	Array.isArray(value.screenSessions) &&
	typeof value.lastEventSequence === 'number';

const projectSummary = (summary: DeviceSummary): DeviceSummary | null => {
	try {
		return projectDeviceStateForCache({
			...createDeviceRuntimeState(summary.id),
			summary: { ...summary, permissionMode: summary.permissionMode || 'always-allow' }
		}).summary;
	} catch {
		return null;
	}
};

const projectState = (state: DeviceRuntimeState): DeviceRuntimeState | null => {
	try {
		const projected = projectDeviceStateForCache(state);
		return projected.deviceId ? projected : null;
	} catch {
		return null;
	}
};

const seenTime = (summary: DeviceSummary): number => {
	const parsed = summary.lastSeenAt ? new Date(summary.lastSeenAt).getTime() : 0;
	return Number.isFinite(parsed) ? parsed : 0;
};

const projectUniqueSummaries = (summaries: DeviceSummary[]): DeviceSummary[] => {
	const byId = new Map<string, DeviceSummary>();
	for (const candidate of summaries) {
		const summary = projectSummary(candidate);
		if (!summary?.id) continue;
		const existing = byId.get(summary.id);
		if (!existing || summary.revision > existing.revision) byId.set(summary.id, summary);
	}
	return [...byId.values()].sort((left, right) => seenTime(right) - seenTime(left) || right.revision - left.revision).slice(0, MAX_CACHED_DEVICES);
};

// List and detail caches are deliberately separate. The list stays small
// enough for synchronous first paint; the selected device gets the richer,
// still-redacted projection from deviceCore.
export const readDeviceListCache = (userId: string | null | undefined): DeviceSummary[] => {
	const cached = readLocalCache<unknown>(deviceListCacheKey(userId));
	if (!record(cached) || cached.version !== DEVICE_CACHE_VERSION || !Array.isArray(cached.devices)) return [];
	return projectUniqueSummaries(cached.devices.filter(isSummaryLike));
};

export const writeDeviceListCache = (userId: string | null | undefined, summaries: DeviceSummary[], now = new Date()): void => {
	const envelope: DeviceListCacheEnvelope = {
		version: DEVICE_CACHE_VERSION,
		writtenAt: now.toISOString(),
		devices: projectUniqueSummaries(summaries)
	};
	writeLocalCache(deviceListCacheKey(userId), envelope);
};

export const readDeviceDetailCache = (userId: string | null | undefined, deviceId: string): DeviceRuntimeState | null => {
	const cached = readLocalCache<unknown>(deviceDetailCacheKey(userId, deviceId));
	if (!record(cached) || cached.version !== DEVICE_CACHE_VERSION || !isRuntimeStateLike(cached.state)) return null;
	const state = projectState(cached.state);
	return state?.deviceId === deviceId ? state : null;
};

export const writeDeviceDetailCache = (userId: string | null | undefined, state: DeviceRuntimeState, now = new Date()): void => {
	const projected = projectState(state);
	if (!projected) return;
	const envelope: DeviceDetailCacheEnvelope = {
		version: DEVICE_CACHE_VERSION,
		writtenAt: now.toISOString(),
		state: projected
	};
	writeLocalCache(deviceDetailCacheKey(userId, state.deviceId), envelope);
};

export const clearDeviceCache = (userId: string | null | undefined, deviceIds: string[] = []): void => {
	clearLocalCache(deviceListCacheKey(userId));
	for (const deviceId of new Set(deviceIds.filter(Boolean))) {
		clearLocalCache(deviceDetailCacheKey(userId, deviceId));
	}
};
