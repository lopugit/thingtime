import type { SyncScope } from './reconcile';
import type { SyncResourceStatus } from './resourceGovernor';

export type DeviceSyncHistoryScope = Omit<SyncScope, 'rootId'>;
export type DeviceSyncHistoryRange = { from: number; to: number; bucketCount: number };
export const deviceSyncHistoryMetrics = ['uploadMbps', 'downloadMbps', 'scanMbps', 'cpuPercent', 'memoryBytes'] as const;
type Metric = typeof deviceSyncHistoryMetrics[number];
type Metrics = Record<Metric, number | null>;
export type DeviceSyncHistorySample = Metrics & {
	at: number; status: 'running' | 'paused' | 'complete' | 'error';
	cpuScopes?: NonNullable<SyncResourceStatus['cpuScopes']>;
};
export type DeviceSyncHistoryBucket = Metrics & { from: number; to: number; samples: number; measured: Record<Metric, number> };
export type DeviceSyncHistory = {
	range: DeviceSyncHistoryRange; buckets: DeviceSyncHistoryBucket[];
	firstObservedAt: number | null; latest: DeviceSyncHistorySample | null; sampleCount: number;
	recordingIssue?: 'storage-unavailable';
};

const statuses = new Set(['running', 'paused', 'complete', 'error']);
const cpuScopes = new Set(['source-thread', 'indexer-process', 'transport-process']);
const invalid = () => Error('Invalid sync history.');
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
const timestamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 8.64e15;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const metric = (key: Metric, v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && (key !== 'cpuPercent' || v <= 100));

export function deviceSyncHistoryScopeKey(scope: DeviceSyncHistoryScope) {
	if (!scope || typeof scope.origin !== 'string' || new URL(scope.origin).origin !== scope.origin ||
		!['https:', 'http:'].includes(new URL(scope.origin).protocol) || [scope.ownerId, scope.deviceId, scope.dataPlane].some(v => typeof v !== 'string' || !v))
		throw invalid();
	return JSON.stringify([scope.origin, scope.ownerId, scope.deviceId, scope.dataPlane]);
}

export function parseDeviceSyncHistoryRange(v: unknown): DeviceSyncHistoryRange {
	if (!object(v) || !exact(v, ['from', 'to', 'bucketCount']) || !timestamp(v.from) || !timestamp(v.to) || v.from >= v.to ||
		!count(v.bucketCount) || v.bucketCount < 1 || v.bucketCount > 240 || v.bucketCount > v.to - v.from) throw invalid();
	return { from: v.from, to: v.to, bucketCount: v.bucketCount };
}

export function parseDeviceSyncHistorySample(v: unknown): DeviceSyncHistorySample {
	if (!object(v) || !exact(v, ['at', 'status', 'cpuScopes', ...deviceSyncHistoryMetrics]) || !timestamp(v.at) ||
		typeof v.status !== 'string' || !statuses.has(v.status) || deviceSyncHistoryMetrics.some(k => !metric(k, v[k])) ||
		(v.cpuScopes !== undefined && (!Array.isArray(v.cpuScopes) || v.cpuScopes.length > cpuScopes.size ||
			new Set(v.cpuScopes).size !== v.cpuScopes.length || v.cpuScopes.some(s => !cpuScopes.has(s))))) throw invalid();
	return v as DeviceSyncHistorySample;
}

function boundaries(range: DeviceSyncHistoryRange, index: number) {
	return range.from + Math.floor(((range.to - range.from) * index) / range.bucketCount);
}

export function createDeviceSyncHistoryAggregation(range: DeviceSyncHistoryRange) {
	const checked = parseDeviceSyncHistoryRange(range);
	const buckets = Array.from({ length: checked.bucketCount }, (_, i): DeviceSyncHistoryBucket => ({
		from: boundaries(checked, i), to: boundaries(checked, i + 1), samples: 0,
		uploadMbps: null, downloadMbps: null, scanMbps: null, cpuPercent: null, memoryBytes: null,
		measured: { uploadMbps: 0, downloadMbps: 0, scanMbps: 0, cpuPercent: 0, memoryBytes: 0 }
	}));
	const summary: DeviceSyncHistory = { range: checked, buckets, latest: null, firstObservedAt: null, sampleCount: 0 };
	let index = 0;
	return {
		add(value: DeviceSyncHistorySample) {
			const sample = parseDeviceSyncHistorySample(value);
			if (sample.at < checked.from || sample.at >= checked.to || (summary.latest && sample.at < summary.latest.at)) throw invalid();
			while (sample.at >= buckets[index].to) index++;
			const bucket = buckets[index];
			bucket.samples++;
			for (const key of deviceSyncHistoryMetrics) {
				const value = sample[key];
				if (value === null) continue;
				const n = ++bucket.measured[key], previous = bucket[key] ?? 0;
				bucket[key] = previous + (value - previous) / n;
			}
			summary.firstObservedAt ??= sample.at;
			summary.latest = sample;
			summary.sampleCount++;
		},
		result: () => summary
	};
}

/** Strict remote projection. Recheck the echoed range and coverage against the
 * immutable request; reject unknown fields at every level. */
export function parseDeviceSyncHistory(v: unknown, expected: DeviceSyncHistoryRange): DeviceSyncHistory {
	const range = parseDeviceSyncHistoryRange(expected);
	if (!object(v) || !exact(v, ['range', 'buckets', 'latest', 'firstObservedAt', 'sampleCount', 'recordingIssue']) ||
		JSON.stringify(parseDeviceSyncHistoryRange(v.range)) !== JSON.stringify(range) ||
		(v.recordingIssue !== undefined && v.recordingIssue !== 'storage-unavailable') ||
		!Array.isArray(v.buckets) || v.buckets.length !== range.bucketCount || !count(v.sampleCount)) throw invalid();
	const latest = v.latest === null ? null : parseDeviceSyncHistorySample(v.latest);
	const first = v.firstObservedAt;
	if (v.sampleCount === 0 ? latest !== null || first !== null :
		!latest || !timestamp(first) || first < range.from || first > latest.at || latest.at >= range.to) throw invalid();
	let total = 0, firstBucket: DeviceSyncHistoryBucket | undefined, lastBucket: DeviceSyncHistoryBucket | undefined;
	for (let i = 0; i < v.buckets.length; i++) {
		const b = v.buckets[i];
		if (!object(b) || !exact(b, ['from', 'to', 'samples', 'measured', ...deviceSyncHistoryMetrics]) || b.from !== boundaries(range, i) ||
			b.to !== boundaries(range, i + 1) || !count(b.samples) || !object(b.measured) || !exact(b.measured, deviceSyncHistoryMetrics)) throw invalid();
		const measured = b.measured, samples = b.samples;
		if (deviceSyncHistoryMetrics.some(k => !metric(k, b[k]) || !count(measured[k]) || measured[k] > samples ||
			((measured[k] === 0) !== (b[k] === null)))) throw invalid();
		total += samples;
		if (samples) {
			firstBucket ??= b as DeviceSyncHistoryBucket;
			lastBucket = b as DeviceSyncHistoryBucket;
		}
	}
	if (total !== v.sampleCount || (latest && (!firstBucket || !lastBucket || !timestamp(first) ||
		first < firstBucket.from || first >= firstBucket.to || latest.at < lastBucket.from || latest.at >= lastBucket.to ||
		deviceSyncHistoryMetrics.some(k => latest[k] !== null && !lastBucket!.measured[k])))) throw invalid();
	return v as DeviceSyncHistory;
}
