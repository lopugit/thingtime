/** Owned disposable-replica child. Synthetic credentials arrive only through
 * private IPC memory, never argv, environment, files, output or receipts. */
import { executeResumableOrdinaryRestore, type OrdinaryRestoreCreation, type OrdinaryRestoreReview } from '../app/api/utils/backups/ordinaryRestoreTransaction';
process.once('message', async (input: { cookie: string; review: OrdinaryRestoreReview; records: OrdinaryRestoreCreation[]; crashOrdinal: number }) => {
	try {
		const request = new Request(input.review.destination.scope.apiOrigin + '/api/v1/things', { headers: { Cookie: input.cookie } });
		await executeResumableOrdinaryRestore(request, input.review, async function* () { yield* input.records; }, {
			afterCheckpoint: async (phase, ordinal) => {
				if (phase === 'effect' && ordinal === input.crashOrdinal) process.exit(73);
			}
		});
		process.exit(74);
	} catch {
		process.exit(75);
	}
});
