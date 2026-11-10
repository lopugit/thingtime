import assert from 'node:assert/strict';
import test from 'node:test';
import { runForegroundCloudSync } from './foregroundSync';
import { executeSyncRun, validateSyncRun } from './execute';

import { retentionFixture as fixture, scope } from './conflictRetention.fixture';

test('Save versions and ignore retains bytes without changing the live file or sync baseline; repeats reuse receipts', async () => {
	const f = await fixture(),
		progress: string[] = [],
		input = f.input();
	const result = await runForegroundCloudSync(f.saved, scope, { ...input, progress: (p) => progress.push(p.stage) }, new AbortController().signal);
	assert.equal(result.version, 2);
	assert.equal(result.intent, 'retain-conflicts');
	assert.ok(result.operations.every((o) => o.confirmed));
	assert.deepEqual(f.live(), f.original);
	assert.equal(await f.journal().checkpoint(scope), null);
	assert.equal(progress.at(-1), 'retained');
	assert.deepEqual(f.counts(), { sourceReads: 1, sourceOpens: 1, uploads: 1, puts: 1, retained: 1, publications: 0, reviews: 1 });
	await f.reload();
	await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.deepEqual(f.counts(), { sourceReads: 1, sourceOpens: 1, uploads: 1, puts: 1, retained: 1, publications: 0, reviews: 2 });
	assert.equal((await f.journal().read(scope))!.id, result.id);
	// A later explicit winner choice must still see the conflict and perform an ordinary sync.
	f.review(async () => [{ path: 'report.bin', from: 'local' }]);
	const synced = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.equal(synced.version, 1);
	assert.equal(f.counts().publications, 1);
	assert.notDeepEqual(f.live(), f.original);
	assert.equal((await f.journal().checkpoint(scope))!.runId, synced.id);
	f.journal().close();
});

test('lost accepted retention recovers after IDB reopen and device-source loss without scanning, rereading or reuploading', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /reply lost/);
	const before = f.counts(),
		pending = await f.journal().read(scope);
	assert.equal(pending!.version, 2);
	assert.equal(pending!.operations[0].confirmed, false);
	f.removeSource();
	await f.reload();
	const done = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	assert.equal(done.id, pending!.id);
	assert.ok(done.operations.every((o) => o.confirmed));
	assert.deepEqual(f.counts(), before);
	assert.deepEqual(f.live(), f.original);
	assert.equal(await f.journal().checkpoint(scope), null);
	f.journal().close();
});

test('capture persists before upload and refuses a changed review', async () => {
	const f = await fixture(),
		input = f.input();
	await assert.rejects(
		runForegroundCloudSync(
			f.saved,
			scope,
			{
				...input,
				journal: {
					...input.journal,
					persist: async () => {
						throw Error('Journal disk full');
					}
				}
			},
			new AbortController().signal
		),
		/disk full/
	);
	assert.equal(f.counts().uploads, 0);
	assert.equal(f.counts().retained, 0);
	f.review(async () => {
		f.edit();
		return { action: 'retain' };
	});
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /changed/);
	assert.equal(await f.journal().read(scope), null);
	assert.equal(f.counts().uploads, 0);
	f.journal().close();
});

test('retention runs cannot be interpreted as sync writes or complete a sync baseline', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal), /reply lost/);
	const saved = (await f.journal().read(scope))!;
	let effects = 0;
	await assert.rejects(
		executeSyncRun(saved, {
			persist: async () => {
				effects++;
			}
		} as any),
		/different executors/
	);
	assert.equal(effects, 0);
	assert.throws(() => validateSyncRun({ ...saved, version: 1 }), /Invalid persisted/);
	assert.throws(() => validateSyncRun({ ...saved, intent: undefined }), /Invalid persisted/);
	await assert.rejects(f.journal().persist({ ...saved, version: 1, intent: undefined }), /cannot change/);
	const done = await runForegroundCloudSync(f.saved, scope, f.input(), new AbortController().signal);
	await assert.rejects(
		f.journal().complete({ version: 1, runId: done.id, localRootId: 'native-root', remoteFolderId: 'cloud-root', baseline: { scope, entries: [] } }),
		/fully confirmed/
	);
	assert.equal(await f.journal().checkpoint(scope), null);
	f.journal().close();
});

test('capture cancellation and account/configuration changes during review refuse uploads', async () => {
	for (const failure of ['cancel', 'account', 'configuration'] as const) {
		const f = await fixture(),
			abort = new AbortController(),
			input = f.input();
		let changed = false;
		f.review(async () => {
			changed = true;
			if (failure === 'cancel') abort.abort(Error('Capture cancelled'));
			return { action: 'retain' };
		});
		await assert.rejects(
			runForegroundCloudSync(
				f.saved,
				scope,
				{
					...input,
					currentScope: () => (changed && failure === 'account' ? { ...scope, ownerId: 'another-account' } : scope),
					readConfiguration: async () => {
						const value = await input.readConfiguration();
						return changed && failure === 'configuration'
							? { ...value, updatedAt: '2026-10-18T00:00:00.000Z', crystal: { ...value.crystal, paused: true } }
							: value;
					}
				},
				abort.signal
			)
		);
		assert.equal(f.counts().uploads, 0);
		assert.equal(f.counts().retained, 0);
		assert.deepEqual(f.live(), f.original);
		assert.equal(await f.journal().read(scope), null);
		f.journal().close();
	}
});
