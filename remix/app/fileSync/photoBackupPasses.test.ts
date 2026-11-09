import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhotoBackupPasses } from './photoBackupPasses';
import type { ForegroundSyncProgress } from './foregroundSync';

const pass = (remaining: number, confirmed = 0): ForegroundSyncProgress => ({
	stage: 'complete', confirmed, total: confirmed, coverage: remaining ? 'partial' : 'full', skipped: remaining
});
test('local backup precedes multiple iCloud batches and stops only after coverage closes', async () => {
	const calls: boolean[] = [];
	const results = [pass(9, 2), pass(5, 4), pass(1, 4), pass(0, 1)];
	const result = await runPhotoBackupPasses(async download => { calls.push(download); return results.shift(); }, () => {}, () => true);
	assert.deepEqual(calls, [false, true, true, true]);
	assert.equal(result?.skipped, 0);
});
test('unchanged, growing, or unauthorized iCloud coverage cannot spin or claim completeness', async () => {
	for (const [allowed, second, expected] of [[true, 7, [false, true]], [true, 8, [false, true]], [false, 7, [false]]] as const) {
		const calls: boolean[] = [];
		const result = await runPhotoBackupPasses(async download => { calls.push(download); return pass(download ? second : 7); }, () => {}, () => allowed);
		assert.deepEqual(calls, expected);
		assert.equal(result?.coverage, 'partial');
	}
});
test('pause, account change and permission loss fence the next iCloud batch', async () => {
	for (const reason of ['Paused', 'Account changed', 'Photos access revoked']) {
		const calls: boolean[] = [];
		const check = () => { if (calls.length) throw Error(reason); };
		await assert.rejects(runPhotoBackupPasses(async download => { calls.push(download); return pass(7); }, check, () => true), { message: reason });
		assert.deepEqual(calls, [false]);
	}
});
