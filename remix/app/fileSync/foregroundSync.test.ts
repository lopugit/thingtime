import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { runForegroundCloudSync } from './foregroundSync';
import { foregroundFixture as fixture, saved, scope } from './foregroundSync.fixture';

test('a user-started run uploads, checkpoints and checks a second time without duplicating destinations', async () => {
	const f = await fixture();
	const first = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(f.creates(), 1);
	assert.ok(first.operations.every((op) => op.confirmed));
	assert.equal((await f.journal().checkpoint(scope))?.baseline.entries.length, 1);
	const second = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(second.operations.length, 0);
	assert.equal(f.creates(), 1);
	f.journal().close();
});
test('lost replies resume the same run after reload; changed reviewed settings and network policy stop effects', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /lost accepted/);
	const original = await f.journal().read(scope);
	await f.reload();
	f.condition('cellular');
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /selected network/);
	assert.equal(f.creates(), 1);
	f.condition('wifi');
	const done = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(done.id, original?.id);
	assert.equal(f.creates(), 1);
	f.change();
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /configuration or device approval changed/);
	f.journal().close();
});

test('foreground downloads recover native receipts and checkpoint failure without republishing or losing later edits', async () => {
	const download = { ...saved, configuration: { ...saved.configuration, mode: 'download' as const } };
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory),
		local: any[] = [],
		publications = 0,
		lose = true;
	const receipts = new Map<string, any>();
	const remote = { kind: 'folder' as const, path: 'Documents', id: 'cloud-documents', folderId: 'cloud-root', revision: 'r1' };
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: download.id,
			updatedAt: download.updatedAt,
			crystal: download.configuration,
			author: { id: scope.ownerId },
			acl: ['tt:user'],
			thingtime: ['file-sync']
		}),
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => structuredClone(local),
		inventory: async () => ({ version: 1 as const, complete: true as const, rootId: 'cloud-root', rootRevision: 'r1', nodes: [remote] }),
		source: async () => {
			throw Error('not an upload');
		},
		journal,
		progress: () => {},
		runtime: {
			currentScope: () => scope,
			origin: () => scope.origin,
			requireCapability: async () => {},
			fetch: async (_url: any, init: any) => {
				assert.equal(init.method, 'GET');
				assert.equal(new URL(String(_url)).searchParams.get('rootId'), 'cloud-root');
				return Response.json({ ok: true, observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'r1', path: remote.path,
					entry: { kind: 'folder', path: remote.path, id: remote.id, version: remote.revision, size: 0, sha256: null } } });
			}
		},
		localTarget: {
			lookup: async (op: any) =>
				receipts.has(op.id) ? { status: 'complete' as const, receipt: receipts.get(op.id) } : { status: 'missing' as const },
			stage: async (op: any) => ({
				scope,
				operationId: op.id,
				token: 'stage',
				entry: { ...op.mutation.source, id: 'local-folder', version: 'local-1' }
			}),
			publish: async (op: any, _scope: any, stage: any) => {
				publications++;
				local = [stage.entry];
				const receipt = { scope, operationId: op.id, entry: stage.entry };
				receipts.set(op.id, receipt);
				if (lose) {
					lose = false;
					throw Error('lost native reply');
				}
				return receipt;
			}
		}
	});
	await assert.rejects(runForegroundCloudSync(download, scope, input(), new AbortController().signal), /lost native reply/);
	const original = await journal.read(scope);
	journal.close();
	journal = await openSyncJournal(factory);
	const realComplete = journal.complete;
	journal.complete = async () => {
		throw Error('checkpoint failure');
	};
	await assert.rejects(runForegroundCloudSync(download, scope, input(), new AbortController().signal), /checkpoint failure/);
	assert.equal(publications, 1);
	assert.equal((await journal.read(scope))?.id, original?.id);
	local[0] = { ...local[0], version: 'local-edited-after-receipt' };
	journal.complete = realComplete;
	const done = await runForegroundCloudSync(download, scope, input(), new AbortController().signal);
	assert.equal(done.operations.length, 0);
	assert.equal(publications, 1);
	const baseline = (await journal.checkpoint(scope))!.baseline.entries[0];
	assert.equal(baseline.local.id, 'local-folder');
	assert.equal(baseline.remote.id, remote.id);
	assert.equal(baseline.local.version, 'local-edited-after-receipt');
	await assert.rejects(
		runForegroundCloudSync(
			{ ...download, configuration: { ...download.configuration, propagateDeletes: true } },
			scope,
			input(),
			new AbortController().signal
		),
		/deletion propagation requires recoverable native Trash/
	);
	journal.close();
});

test('legacy two-way foreground runs recover mixed receipts using their original configuration root', async () => {
	const f = await fixture();
	// Model a durable pre-1.4 queue: the configuration pins the root, while
	// individual writes have no root field. Do not migrate immutable payloads.
	const persist = f.journal().persist;
	f.journal().persist = async run => {
		const legacy = structuredClone(run) as any;
		for (const write of legacy.cloudWrites) delete write.cloudRootId;
		await persist(legacy);
	};
	const twoWay = { ...saved, configuration: { ...saved.configuration, mode: 'two-way' as const } };
	f.rows.set('remote-folder', { id: 'remote-folder', folderId: 'cloud-root', name: 'Downloads', revision: 'r1' });
	const local: any[] = [], receipts = new Map<string, any>();
	let publications = 0, lose = true;
	const input = () => {
		const base = f.input();
		return { ...base,
			readConfiguration: async () => ({ ...(await base.readConfiguration()), crystal: twoWay.configuration }),
			scanLocal: async () => [...await base.scanLocal(), ...structuredClone(local)],
			localTarget: {
				lookup: async (op: any) => receipts.has(op.id) ? { status: 'complete' as const, receipt: receipts.get(op.id) } : { status: 'missing' as const },
				stage: async (op: any) => ({ scope, operationId: op.id, token: 'stage', entry: { ...op.mutation.source, id: 'downloaded-folder', version: 'local-1' } }),
				publish: async (op: any, _scope: any, stage: any) => {
					publications++; local.push(stage.entry);
					const receipt = { scope, operationId: op.id, entry: stage.entry }; receipts.set(op.id, receipt);
					if (lose) { lose = false; throw Error('lost native reply'); } return receipt;
				}
			}
		};
	};
	f.lose();
	await assert.rejects(runForegroundCloudSync(twoWay, scope, input(), new AbortController().signal), /lost accepted creation/);
	const original = await f.journal().read(scope);
	assert.deepEqual(original!.operations.map(op => op.mutation.kind === 'copy' && op.mutation.from), ['local', 'remote']);
	assert.ok((original as any).cloudWrites.every((write: any) => write.cloudRootId === undefined));
	await f.reload();
	await assert.rejects(runForegroundCloudSync(twoWay, scope, input(), new AbortController().signal), /lost native reply/);
	await f.reload();
	const recovered = await runForegroundCloudSync(twoWay, scope, input(), new AbortController().signal);
	assert.equal(recovered.id, original!.id); assert.ok(recovered.operations.every(op => op.confirmed));
	assert.equal(f.creates(), 1); assert.equal(publications, 1);
	assert.equal((await f.journal().checkpoint(scope))!.baseline.entries.length, 2);
	const repeated = await runForegroundCloudSync(twoWay, scope, input(), new AbortController().signal);
	assert.equal(repeated.operations.length, 0); assert.equal(f.creates(), 1); assert.equal(publications, 1);
	f.journal().close();
});

test('two-way foreground refuses missing native approval and delete propagation before any scan', async () => {
	const f = await fixture();
	const unavailable = async (): Promise<never> => { throw Error('unexpected native operation'); };
	for (const propagateDeletes of [false, true]) {
		await assert.rejects(runForegroundCloudSync({ ...saved, configuration: { ...saved.configuration, mode: 'two-way', propagateDeletes } },
			scope, { ...f.input(), scanLocal: unavailable,
				localTarget: propagateDeletes ? { lookup: unavailable, stage: unavailable, publish: unavailable } : undefined
			}, new AbortController().signal), /native write approval/);
	}
	assert.equal(await f.journal().read(scope), null); assert.equal(f.creates(), 0); f.journal().close();
});

test('two-way conflicting initial bytes stop the whole run before native or cloud mutations', async () => {
	const f = await fixture(), base = f.input();
	const twoWay = { ...saved, configuration: { ...saved.configuration, mode: 'two-way' as const } };
	const fingerprint = (hash: string) => ({ algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8388608, partCount: 1, sha256: hash.repeat(64) });
	const unavailable = async (): Promise<never> => { throw Error('unexpected native operation'); };
	await assert.rejects(runForegroundCloudSync(twoWay, scope, {
		...base,
		readConfiguration: async () => ({ ...(await base.readConfiguration()), crystal: twoWay.configuration }),
		scanLocal: async () => [...await base.scanLocal(), { path: 'same.bin', id: 'local-file', version: 'v1', kind: 'file' as const, size: 1, sha256: null, fingerprint: fingerprint('a') }],
		inventory: async () => ({ ...await base.inventory(), nodes: [{ kind: 'file' as const, path: 'same.bin', file: {
			id: 'remote-file', revision: 'r1', folderId: 'cloud-root', name: 'same.bin', trashed: false,
			content: { attachmentId: 'attachment', version: 'b'.repeat(64), size: 1, fingerprint: fingerprint('b') }
		} }] }),
		localTarget: { lookup: unavailable, stage: unavailable, publish: unavailable }
	}, new AbortController().signal), /sync conflict/);
	assert.equal(await f.journal().read(scope), null); assert.equal(f.creates(), 0); f.journal().close();
});

test('native authorization cooldown does not spend the upcoming HTTP request deadline', async (t) => {
	const f = await fixture(),
		input = f.input();
	t.after(() => f.journal().close());
	const deadlines: AbortController[] = [];
	t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
		assert.equal(milliseconds, 30_000);
		const controller = new AbortController();
		deadlines.push(controller);
		return controller.signal;
	});
	input.authorizeDevice = async () => {
		// Model the verified 47-second native cooldown without wall-clock sleep.
		// Every HTTP deadline which already started must now have expired.
		for (const controller of deadlines) controller.abort(new DOMException('HTTP deadline expired', 'TimeoutError'));
	};
	const fetch = input.runtime.fetch;
	input.runtime.fetch = async (url, init) => {
		init.signal.throwIfAborted();
		return fetch(url, init);
	};
	const result = await runForegroundCloudSync(saved, scope, input, new AbortController().signal);
	assert.equal(f.creates(), 1);
	assert.ok(result.operations.every((operation) => operation.confirmed));
});

test('conflict review rechecks files, settings, identity and cancellation before recording any effects', async () => {
	for (const change of ['local', 'remote', 'configuration', 'scope', 'abort', 'cancel']) {
		const f = await fixture(), base = f.input(), signal = new AbortController();
		let revision = 'r1', localVersion = 'v1', currentScope = scope;
		const fp = (value: string) => ({ algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8388608, partCount: 1, sha256: value.repeat(64) });
		const input = { ...base,
			currentScope: () => currentScope,
			scanLocal: async () => [{ path: 'same.bin', id: 'local', version: localVersion, kind: 'file' as const, size: 1, sha256: null, fingerprint: fp('a') }],
			inventory: async () => ({ ...await base.inventory(), nodes: [{ kind: 'file' as const, path: 'same.bin', file: {
				id: '11111111-1111-4111-8111-111111111111', revision, folderId: 'cloud-root', name: 'same.bin', trashed: false,
				content: { attachmentId: 'attachment', version: 'b'.repeat(64), size: 1, fingerprint: fp('b') }
			} }] }),
			reviewConflicts: async (conflicts: any[]) => {
				assert.equal(conflicts.length, 1); assert.equal(await f.journal().read(scope), null);
				if (change === 'local') localVersion = 'v2';
				if (change === 'remote') revision = 'r2';
				if (change === 'configuration') f.change();
				if (change === 'scope') currentScope = { ...scope, ownerId: 'other' };
				if (change === 'abort') signal.abort();
				if (change === 'cancel') throw Error('Review cancelled');
				// The UI's copy cannot alter the exact snapshot retained by the runner.
				conflicts[0].local.version = localVersion;
				return [{ path: 'same.bin', from: 'local' as const }];
			}
		};
		await assert.rejects(runForegroundCloudSync(saved, scope, input, signal.signal), /changed|cancelled|abort/i);
		assert.equal(await f.journal().read(scope), null); assert.equal(f.creates(), 0); f.journal().close();
	}
});

test('accepted conflict choices enter the existing durable run and retry never asks for a new choice', async () => {
	const f = await fixture(), base = f.input();
	const fp = (value: string) => ({ algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8388608, partCount: 1, sha256: value.repeat(64) });
	let reviews = 0;
	const persist = base.journal.persist;
	const input = { ...base,
		scanLocal: async () => [{ path: 'same.bin', id: 'local', version: 'v1', kind: 'file' as const, size: 1, sha256: null, fingerprint: fp('a') }],
		inventory: async () => ({ ...await base.inventory(), nodes: [{ kind: 'file' as const, path: 'same.bin', file: {
			id: '11111111-1111-4111-8111-111111111111', revision: 'r1', folderId: 'cloud-root', name: 'same.bin', trashed: false,
			content: { attachmentId: 'attachment', version: 'b'.repeat(64), size: 1, fingerprint: fp('b') }
		} }] }),
		reviewConflicts: async () => { reviews++; return [{ path: 'same.bin', from: 'local' as const }]; },
		journal: { ...base.journal, persist: async (run: any) => { await persist(run); throw Error('Stopped after durable journal'); } }
	};
	await assert.rejects(runForegroundCloudSync(saved, scope, input, new AbortController().signal), /durable journal/);
	const before = await f.journal().read(scope);
	assert.equal(before!.operations.length, 1);
	assert.equal((before!.operations[0].mutation as any).expectedTarget.version, 'r1');
	await assert.rejects(runForegroundCloudSync(saved, scope, input, new AbortController().signal), /durable journal/);
	assert.equal(reviews, 1); assert.deepEqual(await f.journal().read(scope), before); f.journal().close();
});
