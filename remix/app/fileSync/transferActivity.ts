import { TransferSpeedSeries } from './transferSpeed';
import type { ForegroundSyncProgress } from './foregroundSync';

/** Payload bytes acknowledged by a transport, excluding retained resume offsets.
 * Logical entries count only newly executed, durably confirmed copy operations. */
export type TransferActivity = { direction: 'upload' | 'download' } &
	({ bytes: number | null } | { kind: 'file' | 'folder' });

export function createTransferActivitySession(options: { now?: () => number } = {}) {
	const series = new TransferSpeedSeries(options);
	const counters = { upload: { bytes: 0 as number | null, files: 0, folders: 0 }, download: { bytes: 0 as number | null, files: 0, folders: 0 } };
	series.pause();
	let active = false;
	const stage = (value: ForegroundSyncProgress['stage']) => {
		const next = value === 'transferring' || value === 'retaining';
		if (next === active) return;
		active = next;
		if (next) { series.resume(); series.observe(counters); } else series.pause();
	};
	return {
		series, stage,
		add(event: TransferActivity) {
			if (!active) stage('transferring');
			const target = counters[event.direction];
			if (!target) throw Error('Invalid transfer direction.');
			const field = 'bytes' in event ? 'bytes' : event.kind === 'file' ? 'files' : event.kind === 'folder' ? 'folders' : null;
			if (!field) throw Error('Invalid transfer entry kind.');
			const value = 'bytes' in event ? event.bytes : 1;
			if (value === null) target.bytes = null;
			else {
				if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid transferred count.');
				const previous = target[field];
				if (previous !== null) {
					const next = previous + value;
					if (!Number.isSafeInteger(next)) throw Error('Transferred count exceeds its safe bound.');
					target[field] = next;
				}
			}
			series.observe(counters);
		},
		stop() { active = false; series.pause(); },
		clear() { active = false; series.reset(); series.pause(); }
	};
}
