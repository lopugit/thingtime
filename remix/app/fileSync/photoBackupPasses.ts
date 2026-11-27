import type { ForegroundSyncProgress } from './foregroundSync';

/** Seal and publish local work before fetching iCloud resources. A later pass
 * has a small native download budget and continues only when confirmed coverage
 * improved. No-progress retries are left to the ordinary durable scheduler. */
export async function runPhotoBackupPasses(
	execute: (downloadCloud: boolean) => Promise<ForegroundSyncProgress | undefined>,
	check: () => void,
	mayDownload: () => boolean
) {
	let previous: number | undefined;
	for (;;) {
		check();
		const result = await execute(previous !== undefined);
		check();
		const remaining = result?.stage === 'complete' && result.coverage === 'partial' ? result.skipped : undefined;
		if (!mayDownload() || !Number.isSafeInteger(remaining) || remaining! <= 0 ||
			(previous !== undefined && remaining! >= previous)) return result;
		previous = remaining;
	}
}

/** A prepared batch advances only after canonical publication and durable
 * native acknowledgement. A prior version's already-started work reconciles
 * once before the first ordered batch; it cannot acknowledge another batch. */
export async function runNativePhotoQueue(
	execute: () => Promise<{ progress?: ForegroundSyncProgress; photoQueue?: import('./nativeInventory').NativePhotoQueueBatch; replacedPhotoBatch?: boolean }>,
	acknowledge: (batch: import('./nativeInventory').NativePhotoQueueBatch) => Promise<void>,
	check: () => void,
	epoch: string
) {
	let prior: string | undefined, refreshedWithoutAck = false, legacy = false;
	for (;;) {
		check();
		const result = await execute();
		check();
		if (result.progress?.stage === 'retained') return result;
		const batch = result.photoQueue;
		if (result.replacedPhotoBatch && result.progress?.stage === 'complete' && batch) {
			if (refreshedWithoutAck) throw Error('The Photos selection changed again. Retry to refresh the current batch.');
			refreshedWithoutAck = true; continue;
		}
		if (!batch) {
			if (legacy || result.progress?.stage !== 'complete') throw Error('The Photos queue did not produce a verified batch.');
			legacy = true; continue;
		}
		if (result.progress?.stage !== 'complete' || batch.epoch !== epoch || batch.id === prior)
			throw Error('The Photos batch changed before acknowledgement.');
		await acknowledge(batch);
		check();
		refreshedWithoutAck = false;
		// Recheck membership after the last nonempty batch. A new arrival can
		// appear during the final upload even if the earlier count was zero.
		if (!batch.pending && !batch.assetKeys.length) return result;
		prior = batch.id;
	}
}
