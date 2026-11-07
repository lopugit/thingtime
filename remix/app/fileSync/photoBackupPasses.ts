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
