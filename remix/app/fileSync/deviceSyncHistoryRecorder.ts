import type { DeviceSyncHistorySample } from './deviceSyncHistory';
import type { ForegroundSyncProgress } from './foregroundSync';
import type { SyncResourceStatus } from './resourceGovernor';
import type { TransferActivity } from './transferActivity';

type TerminalStatus = Exclude<DeviceSyncHistorySample['status'], 'running'>;
export const DEVICE_SYNC_HISTORY_INTERVAL_MS = 5_000;

/** The admitted runner owns this recorder. A payload receipt is not timed
 * transport telemetry: only a source meter can measure an interval that may
 * have transferred bytes. Quiet observed intervals can still report zero. */
export function createDeviceSyncHistoryRecorder(input: {
	write(sample: DeviceSyncHistorySample): Promise<void>; onStorageStatus?(available: boolean): void;
	readResources?(signal: AbortSignal): Promise<SyncResourceStatus | undefined>;
	wallTime?: () => number; monotonicTime?: () => number;
}) {
	const wallTime = input.wallTime ?? Date.now, clock = input.monotonicTime ?? (() => performance.now());
	let lastAt = clock(), lastWallAt = wallTime(), resource: SyncResourceStatus | undefined, lastResourceAt = -1;
	let pending: Promise<void> | undefined, reading: Promise<void> | undefined, stopped = false, mayTransfer = false;
	let opaque = { upload: false, download: false };
	const readLifetime = new AbortController();
	const append = (sample: DeviceSyncHistorySample) => Promise.resolve().then(() => input.write(sample)).then(
		() => input.onStorageStatus?.(true),
		// Optional telemetry must not interrupt admitted file IO. Missing
		// samples remain gaps and the reader can report the storage warning.
		() => input.onStorageStatus?.(false)
	).catch(() => {});
	const observe = (value: SyncResourceStatus) => {
		if (!stopped && (value.measuredAt ?? -1) > (resource?.measuredAt ?? -1)) resource = value;
	};
	const read = () => {
		if (stopped || reading || !input.readResources) return;
		const signal = AbortSignal.any([readLifetime.signal, AbortSignal.timeout(2_500)]);
		reading = Promise.resolve().then(() => input.readResources!(signal)).then(value => {
			if (!signal.aborted && value) observe(value);
		}).catch(() => { /* Busy or unavailable meters leave gaps. */ }).finally(() => { reading = undefined; });
	};
	const take = (status: DeviceSyncHistorySample['status']): DeviceSyncHistorySample => {
		const at = wallTime(), now = clock(), elapsed = now - lastAt, wallElapsed = at - lastWallAt;
		const previousWallAt = lastWallAt;
		lastAt = now; lastWallAt = at;
		const continuous = elapsed > 0 && elapsed <= DEVICE_SYNC_HISTORY_INTERVAL_MS * 2 &&
			wallElapsed > 0 && wallElapsed <= DEVICE_SYNC_HISTORY_INTERVAL_MS * 2;
		const measuredAt = resource?.measuredAt;
		const current = measuredAt !== undefined && measuredAt > lastResourceAt && at >= measuredAt &&
			at - measuredAt <= DEVICE_SYNC_HISTORY_INTERVAL_MS * 1.5 ? resource : undefined;
		if (current) lastResourceAt = measuredAt!;
		// The meter is a point-in-time source observation. Do not reuse it, or
		// substitute the entire delayed batch receipt for bytes in this window.
		const rate = (direction: keyof typeof opaque, value: number | null | undefined) => {
			if (typeof value === 'number' && measuredAt! >= previousWallAt) return value * 0.000008;
			return continuous && !opaque[direction] && !mayTransfer ? 0 : null;
		};
		const uploadMbps = rate('upload', current?.currentUploadBytesPerSecond);
		const downloadMbps = rate('download', current?.currentDownloadBytesPerSecond);
		opaque = { upload: mayTransfer, download: mayTransfer };
		const scan = current?.scanBytesPerSecond;
		const cpuPercent = current?.cpuStatus === 'measured' ? current.cpuPercent : null;
		return { at, status, uploadMbps, downloadMbps,
			scanMbps: typeof scan === 'number' ? scan * 0.000008 : null, cpuPercent,
			memoryBytes: current?.memoryBytes ?? null, ...(cpuPercent !== null && current?.cpuScopes ? { cpuScopes: current.cpuScopes } : {}) };
	};
	const tick = () => {
		const sample = take('running');
		if (!pending) pending = append(sample).finally(() => { pending = undefined; });
		read();
	};
	pending = append({ at: wallTime(), status: 'running', uploadMbps: null, downloadMbps: null, scanMbps: null,
		cpuPercent: null, memoryBytes: null }).finally(() => { pending = undefined; });
	read();
	const timer = setInterval(tick, DEVICE_SYNC_HISTORY_INTERVAL_MS);
	return {
		observe,
		stage(value: ForegroundSyncProgress['stage']) {
			mayTransfer = value === 'transferring' || value === 'retaining';
			if (mayTransfer) opaque = { upload: true, download: true };
		},
		transfer(event: TransferActivity) {
			if (!stopped && 'bytes' in event) opaque[event.direction] = true;
		},
		async finish(terminal: TerminalStatus | Promise<TerminalStatus>) {
			if (stopped) return;
			stopped = true; clearInterval(timer); readLifetime.abort();
			const last = take('running');
			await pending;
			if ([last.cpuPercent, last.memoryBytes, last.scanMbps].some(value => value !== null) ||
				(last.uploadMbps ?? 0) > 0 || (last.downloadMbps ?? 0) > 0) await append(last);
			const status = await terminal;
			await append({ at: last.at, status, uploadMbps: status === 'error' ? null : 0, downloadMbps: status === 'error' ? null : 0,
				scanMbps: null, cpuPercent: null, memoryBytes: null });
		}
	};
}
