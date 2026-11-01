import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { prepareCloudInventoryWrite } from './cloudWrite';
import type { PagedRunSpec } from './pagedRunJournal';
import type { SyncEntry } from './reconcile';
import type { SyncOperation } from './execute';
import { executeCloudUploadBatch } from './cloudUploadBatch.client';
import { attachmentIdForRequest } from '../api/utils/attachments/attachments';
import { uploadBatchDigest } from './uploadBatch';

const seed = JSON.parse(readFileSync(new URL('./fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0].descriptor.members[0].write
	.operation.mutation.source;
const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
const spec = (): PagedRunSpec => ({
	id: crypto.randomUUID(),
	configuration: saved.configuration,
	streaming: { source: 'local', captureId: crypto.randomUUID() },
	plan: {
		id: crypto.randomUUID(),
		local: identity('local'),
		remote: identity('remote'),
		baseline: { local: identity('local'), remote: identity('remote') },
		policy: { mode: 'backup', propagateDeletes: false },
		excludedPaths: []
	}
});
const make = (path: string, sequence: number): SyncEntry => ({ ...structuredClone(seed), path, id: `inode-${sequence}` });
async function setup(count: number, paths: string[] = [], sourceIds: string[] = []) {
	const f = await foregroundFixture(),
		s = spec(),
		access = { scope, currentScope: () => scope };
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	const operations: SyncOperation[] = [];
	for (let sequence = 1; sequence <= count; sequence++) {
		const source = make(paths[sequence - 1] ?? `f${String(sequence).padStart(4, '0')}`, sequence);
		if (sourceIds[sequence - 1]) source.id = sourceIds[sequence - 1];
		const operation: SyncOperation = {
			id: crypto.randomUUID(),
			confirmed: false,
			mutation: { kind: 'copy', from: 'local', path: source.path, source, expectedTarget: null }
		};
		operations.push(operation);
		await runs.appendStream(
			s,
			{ generation: s.streaming!.captureId, sequence, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') }
		);
	}
	return {
		f,
		s,
		operations,
		runs: () => runs,
		reopen: async () => {
			await f.reload();
			runs = f.journal().pagedRuns(access);
		}
	};
}
const receipt = (operation: SyncOperation) => {
	if (operation.mutation.kind !== 'copy') throw Error('Expected upload');
	return { operationId: operation.id, scope, entry: { ...operation.mutation.source, id: operation.id, version: 'cloud-1' } };
};

test('a256member durable claim retains exact IDs, supports out-of-order receipts and survives restart', async () => {
	const f = await setup(260),
		batch = await f.runs().claimUploadBatch(f.s, saved);
	assert.equal(batch!.members.length, 256);
	assert.deepEqual(new Set(batch!.members.map((m) => m.write.operation.id)), new Set(f.operations.slice(0, 256).map((op) => op.id)));
	const digest = await uploadBatchDigest(batch);
	await f.runs().confirm(f.s, receipt(batch!.members[255].write.operation));
	assert.equal((await f.runs().active())!.progress.confirmed, 1);
	await f.reopen();
	assert.equal(await uploadBatchDigest(await f.runs().claimUploadBatch(f.s, saved)), digest, 'partial confirmation cannot regroup/re-key the batch');
	for (const member of batch!.members.slice(0, 255)) await f.runs().confirm(f.s, receipt(member.write.operation));
	assert.equal((await f.runs().active())!.progress.confirmed, 256);
	assert.equal((await f.runs().claimUploadBatch(f.s, saved))!.members.length, 4);
	f.f.journal().close();
});

test('old capability fallback recovers every active member individually before ordinary work', async () => {
	const f = await setup(3),
		batch = await f.runs().claimUploadBatch(f.s, saved);
	await f.reopen();
	for (const member of batch!.members) {
		const next = await f.runs().claimNext(f.s, false);
		assert.equal(next!.id, member.write.operation.id);
		assert.equal(await f.runs().claimUploadBatch(f.s, saved), null, 'uncertain reserved member must finish first');
		await f.runs().confirm(f.s, receipt(next!));
	}
	assert.equal(await f.runs().claimNext(f.s, false), null);
	f.f.journal().close();
});

test('pre-existing uncertain reservation never joins a new batch and a single ready file flushes immediately', async () => {
	const f = await setup(2),
		prior = await f.runs().claimNext(f.s);
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
	await f.runs().confirm(f.s, receipt(prior!));
	const batch = await f.runs().claimUploadBatch(f.s, saved);
	assert.equal(batch!.members.length, 1);
	assert.equal(batch!.members[0].write.operation.id, f.operations[1].id);
	assert.equal((await f.runs().streamState(f.s)).terminal, false, 'batch admission cannot seal a still-indexing source');
	await assert.rejects(f.runs().claimUploadBatch(f.s, { ...saved, updatedAt: '2026-10-22T00:00:00.000Z' }), /configuration changed/);
	f.f.journal().close();
});

test('exact priority prefix excludes similarly named siblings before the next requested priority', async () => {
	const f = await setup(3, ['f0001', 'f00010', 'f0002']);
	await f.f
		.journal()
		.priorities({ scope, currentScope: () => scope })
		.save(['f0001', 'f0002'], 0);
	const first = await f.runs().claimUploadBatch(f.s, saved);
	assert.deepEqual(
		first!.members.map((m) => m.write.operation.mutation.path),
		['f0001']
	);
	await f.runs().confirm(f.s, receipt(first!.members[0].write.operation));
	const second = await f.runs().claimUploadBatch(f.s, saved);
	assert.deepEqual(
		second!.members.map((m) => m.write.operation.mutation.path),
		['f0002']
	);
	f.f.journal().close();
});

test('partial source failure forces individual recovery and unknown canonical dispatch cannot be retired', async () => {
	const f = await setup(3),
		batch = (await f.runs().claimUploadBatch(f.s, saved))!;
	await f.runs().markUploadBatchCommit(f.s, batch.batchId, [0, 1]);
	await f.runs().confirm(f.s, receipt(batch.members[0].write.operation));
	await f.runs().recoverUploadBatch(f.s);
	await f.reopen();
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null, 'released members cannot be instantly regrouped');
	const unknown = await f.runs().claimNext(f.s);
	assert.equal(unknown!.id, batch.members[1].write.operation.id);
	await assert.rejects(f.runs().skipUnpublishedStreamOperation(f.s, unknown!.id, false), /may still be in flight/);
	assert.equal((await f.runs().active())!.progress.confirmed, 1);
	await f.runs().confirm(f.s, receipt(unknown!)); // A later exact receipt wins without source IO.
	const undispatched = await f.runs().claimNext(f.s);
	assert.equal(undispatched!.id, batch.members[2].write.operation.id);
	await f.runs().skipUnpublishedStreamOperation(f.s, undispatched!.id, false);
	assert.equal((await f.runs().active())!.progress.operations, 2);
	assert.equal((await f.runs().streamState(f.s)).terminal, false);
	f.f.journal().close();
});

test('fallback cannot steal a newly eligible bulk member', async () => {
	const f = await setup(1);
	assert.equal(await f.runs().claimNext(f.s, true, 512, true), null);
	assert.equal((await f.runs().claimUploadBatch(f.s, saved))!.members[0].write.operation.id, f.operations[0].id);
	f.f.journal().close();
});

test('512 eligible operations keep batching when the producer refills every confirmed slot across restart', async () => {
	const f = await setup(512);
	let sequence = 512;
	const confirmed = new Set<string>();
	for (let cycle = 0; cycle < 3; cycle++) {
		await f.reopen();
		assert.equal((await f.runs().active())!.progress.operations - (await f.runs().active())!.progress.confirmed, 512);
		const batch = (await f.runs().claimUploadBatch(f.s, saved))!;
		assert.ok(batch, 'a producer-filled queue must not force scalar execution');
		assert.equal(batch.members.length, 256);
		const digest = await uploadBatchDigest(batch);
		for (const [index, member] of batch.members.entries()) {
			assert.equal(confirmed.has(member.write.operation.id), false, 'never reuse an accepted operation');
			await f.runs().confirm(f.s, receipt(member.write.operation));
			confirmed.add(member.write.operation.id);
			const source = make(`refill-${++sequence}`, sequence);
			const operation: SyncOperation = {
				id: crypto.randomUUID(), confirmed: false,
				mutation: { kind: 'copy', from: 'local', path: source.path, source, expectedTarget: null }
			};
			await f.runs().appendStream(f.s, { generation: f.s.streaming!.captureId, sequence, revision: source.version, entry: source },
				{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') });
			if (index === 127) {
				await f.reopen();
				assert.equal(await uploadBatchDigest(await f.runs().claimUploadBatch(f.s, saved)), digest, 'restart retains the in-flight batch IDs');
			}
		}
	}
	assert.equal(confirmed.size, 768);
	assert.equal((await f.runs().streamState(f.s)).terminal, false);
	f.f.journal().close();
});

test('full512queue frees only one ordinary slot for a proven priority, then runs its outside-prefix ancestors', async () => {
	const f = await setup(512), access = { scope, currentScope: () => scope };
	await f.runs().enableStreamPriorities(f.s);
	const inputs = ['Z', 'Z/sub', 'Z/sub/target'].map((path, index) => {
		const entry: SyncEntry = index === 2 ? make(path, 513 + index) : { path, id: 'folder-' + path, version: '1', kind: 'folder', size: 0, sha256: null };
		return { sequence: 513 + index, revision: entry.version, entry };
	});
	await f.runs().appendStreamInput(f.s, f.s.streaming!.captureId, inputs, false);
	await f.f.journal().priorities(access).save(['Z/sub/target'], 0);
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null, 'ordinary work cannot expand into a batch before priority preparation');
	const ordinary = (await f.runs().claimNext(f.s, true, 512, true))!;
	assert.equal(ordinary.id, f.operations[0].id);
	await f.runs().confirm(f.s, receipt(ordinary));
	await f.reopen();
	for (const input of inputs) {
		assert.equal(await f.runs().claimUploadBatch(f.s, saved), null, 'an ordinary batch cannot take the available priority preparation slot');
		assert.equal(await f.runs().claimNext(f.s, true, 512, true), null, '511 pending holds the available priority slot, using the actual capacity');
		const selected = (await f.runs().nextStreamInput(f.s))!;
		assert.equal(selected.entry.path, input.entry.path);
		const operation: SyncOperation = {
			id: crypto.randomUUID(), confirmed: false,
			mutation: { kind: 'copy', from: 'local', path: selected.entry.path, source: selected.entry, expectedTarget: null }
		};
		await f.runs().appendStream(f.s, selected, { write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') });
		if (input.entry.kind === 'folder') {
			assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
			const ancestor = (await f.runs().claimNext(f.s, true, 512, true))!;
			assert.equal(ancestor.id, operation.id, 'the outside-prefix ancestor must execute before ordinary work');
			await f.runs().confirm(f.s, receipt(ancestor));
		} else {
			const batch = (await f.runs().claimUploadBatch(f.s, saved))!;
			assert.deepEqual(batch.members.map(member => member.write.operation.id), [operation.id]);
			await f.runs().confirm(f.s, receipt(batch.members[0].write.operation));
		}
		await f.reopen();
	}
	assert.equal((await f.runs().streamState(f.s)).sequence, 515);
	f.f.journal().close();
});

test('an absent priority does not hold an otherwise eligible full queue', async () => {
	const f = await setup(512), access = { scope, currentScope: () => scope };
	await f.runs().enableStreamPriorities(f.s);
	await f.f.journal().priorities(access).save(['not-indexed'], 0);
	assert.equal((await f.runs().claimUploadBatch(f.s, saved))!.members.length, 256);
	f.f.journal().close();
});

test('reserved and recovery IDs still run first at full capacity', async () => {
	const f = await setup(512), access = { scope, currentScope: () => scope };
	await f.runs().enableStreamPriorities(f.s);
	await f.f.journal().priorities(access).save(['not-indexed'], 0);
	const reserved = (await f.runs().claimNext(f.s, true, 512))!;
	await f.reopen();
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
	assert.equal((await f.runs().claimNext(f.s, true, 512))!.id, reserved.id);
	await f.runs().confirm(f.s, receipt(reserved));
	const batch = (await f.runs().claimUploadBatch(f.s, saved))!;
	assert.equal(batch.members.length, 256);
	await f.runs().recoverUploadBatch(f.s);
	await f.reopen();
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
	assert.equal((await f.runs().claimNext(f.s, true, 512))!.id, batch.members[0].write.operation.id);
	f.f.journal().close();
});

test('hardlink paths remain durable with original IDs but never share one native batch', async () => {
	const f = await setup(3, ['first', 'hardlink', 'independent'], ['same-inode', 'same-inode', 'other-inode']);
	const first = (await f.runs().claimUploadBatch(f.s, saved))!;
	assert.deepEqual(
		first.members.map((m) => m.write.operation.mutation.path),
		['first', 'independent']
	);
	for (const member of first.members) await f.runs().confirm(f.s, receipt(member.write.operation));
	await f.reopen();
	const second = (await f.runs().claimUploadBatch(f.s, saved))!;
	assert.deepEqual(
		second.members.map((m) => m.write.operation.id),
		[f.operations[1].id]
	);
	await f.runs().confirm(f.s, receipt(second.members[0].write.operation));
	assert.equal((await f.runs().active())!.progress.confirmed, 3);
	f.f.journal().close();
});

test('priority change during initial claim preserves only reserved member before new preference', async () => {
	const f = await setup(512, ['a-first', 'b-ordinary', 'z-priority']);
	const runs = f.runs(),
		original = runs.claimNext;
	runs.claimNext = async (...args) => {
		const result = await original.apply(runs, args);
		await f.f
			.journal()
			.priorities({ scope, currentScope: () => scope })
			.save(['z-priority'], 0);
		return result;
	};
	assert.equal(await runs.claimUploadBatch(f.s, saved), null);
	runs.claimNext = original;
	assert.equal((await runs.claimNext(f.s))!.id, f.operations[0].id);
	await runs.confirm(f.s, receipt(f.operations[0]));
	const next = (await runs.claimUploadBatch(f.s, saved))!;
	assert.deepEqual(
		next.members.map((m) => m.write.operation.id),
		[f.operations[2].id]
	);
	f.f.journal().close();
});

test('mixed replay, ready stored content, changed source and successful PUT confirm only actual receipts', async () => {
	const f = await setup(4),
		batch = (await f.runs().claimUploadBatch(f.s, saved))!;
	const content = (ordinal: number) => ({
		ordinal,
		uploadId: attachmentIdForRequest(scope.ownerId, batch.members[ordinal].write.operation.id),
		version: 'b'.repeat(64),
		size: 4,
		fingerprint: seed.fingerprint
	});
	const file = (ordinal: number) => {
		const write = batch.members[ordinal].write,
			c = content(ordinal);
		return {
			id: write.operation.id,
			revision: 'cloud-1',
			name: write.operation.mutation.path,
			folderId: write.folderId,
			trashed: false,
			content: { attachmentId: c.uploadId, version: c.version, size: c.size, fingerprint: c.fingerprint }
		};
	};
	let dispatched = false,
		posts = 0;
	const failed = await executeCloudUploadBatch(
		batch,
		async (request) => ({
			ok: true,
			version: 1,
			batchId: batch.batchId,
			digest: request.digest,
			results: [
				{ ordinal: 0, status: 'confirmed', file: file(0), replayed: true },
				{ ordinal: 1, status: 'verified', content: content(1) },
				{ ordinal: 2, status: 'failed', statusCode: 409, code: 'source-changed', retryable: false },
				{ ordinal: 3, status: 'verified', content: content(3) }
			],
			payloads: [
				{ ordinal: 0, bytes: 0 },
				{ ordinal: 1, bytes: 0 },
				{ ordinal: 2, bytes: 0 },
				{ ordinal: 3, bytes: 4 }
			]
		}),
		{
			currentScope: () => scope,
			origin: () => scope.origin,
			requireCapability: async () => {},
			authorizeMutation: async () => {},
			fetch: async (_url, init) => {
				assert.equal(dispatched, true);
				posts++;
				const body = JSON.parse(String(init!.body));
				assert.deepEqual(
					body.contents.map((c: any) => c.ordinal),
					[1, 3]
				);
				return Response.json({
					ok: true,
					version: 1,
					batchId: batch.batchId,
					digest: body.digest,
					results: [1, 3].map((ordinal) => ({ ordinal, status: 'confirmed', file: file(ordinal), replayed: false }))
				});
			}
		},
		new AbortController().signal,
		{
			markCommit: async (ordinals) => {
				await f.runs().markUploadBatchCommit(f.s, batch.batchId, ordinals);
				dispatched = true;
			},
			confirm: async (result) => {
				await f.runs().confirm(f.s, result);
			}
		}
	);
	assert.equal(posts, 1);
	assert.deepEqual(
		failed.map((r) => r.ordinal),
		[2]
	);
	assert.equal((await f.runs().active())!.progress.confirmed, 3);
	await f.runs().recoverUploadBatch(f.s);
	await f.reopen();
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
	const remaining = (await f.runs().claimNext(f.s))!;
	assert.equal(remaining.id, batch.members[2].write.operation.id);
	await f.runs().skipUnpublishedStreamOperation(f.s, remaining.id, false);
	assert.equal((await f.runs().streamState(f.s)).terminal, false, 'no synthetic baseline/seal for failed source');
	f.f.journal().close();
});

test('v13 retained single operations upgrade without new IDs and older clients cannot ignore batch claims', async () => {
	const factory = new IDBFactory(),
		name = 'retained-v13-bulk-test';
	const legacyFactory = { open: (n: string) => factory.open(n, 13) } as IDBFactory;
	let journal = await openSyncJournal(legacyFactory, name, IDBKeyRange);
	const s = spec(),
		access = { scope, currentScope: () => scope },
		source = make('retained', 1);
	const operation: SyncOperation = {
		id: crypto.randomUUID(),
		confirmed: false,
		mutation: { kind: 'copy', from: 'local', path: source.path, source, expectedTarget: null }
	};
	await journal.pagedRuns(access).begin(s);
	await journal
		.pagedRuns(access)
		.appendStream(
			s,
			{ generation: s.streaming!.captureId, sequence: 1, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') }
		);
	journal.close();
	journal = await openSyncJournal(factory, name, IDBKeyRange);
	const batch = (await journal.pagedRuns(access).claimUploadBatch(s, saved))!;
	assert.equal(batch.members[0].write.operation.id, operation.id);
	journal.close();
	await new Promise<void>((resolve, reject) => {
		const old = factory.open(name, 13);
		old.onsuccess = () => {
			old.result.close();
			reject(Error('An old client opened active batch storage'));
		};
		old.onerror = () => {
			assert.equal(old.error?.name, 'VersionError');
			resolve();
		};
	});
});

test('bulk A→B→A observations keep three original revision IDs and latest receipt after restart', async () => {
	const f = await setup(1),
		ids: string[] = [];
	for (const [index, version] of ['v1', 'v2', 'v1'].entries()) {
		if (index) {
			const source = { ...make('f0001', 1), version },
				operation: SyncOperation = {
					id: crypto.randomUUID(),
					confirmed: false,
					mutation: { kind: 'copy', from: 'local', path: source.path, source, expectedTarget: null }
				};
			await f
				.runs()
				.appendStream(
					f.s,
					{ generation: f.s.streaming!.captureId, sequence: index + 1, revision: version, entry: source },
					{ write: prepareCloudInventoryWrite(operation, scope, 'cloud-root', null, 'cloud-root') }
				);
		}
		const batch = (await f.runs().claimUploadBatch(f.s, saved))!;
		ids.push(batch.members[0].write.operation.id);
		await f.runs().confirm(f.s, receipt(batch.members[0].write.operation));
		await f.reopen();
	}
	assert.equal(new Set(ids).size, 3);
	assert.equal((await f.runs().streamPrevious(f.s, 'f0001'))!.operation.id, ids[2]);
	assert.equal((await f.runs().streamState(f.s)).sequence, 3);
	f.f.journal().close();
});

test('native authority failure blocks canonical dispatch even when another member is verified', async () => {
	const f = await setup(2),
		batch = (await f.runs().claimUploadBatch(f.s, saved))!;
	let marked = false,
		posted = false;
	await assert.rejects(
		executeCloudUploadBatch(
			batch,
			async (request) => ({
				ok: true,
				version: 1,
				batchId: batch.batchId,
				digest: request.digest,
				results: [
					{
						ordinal: 0,
						status: 'verified',
						content: { ordinal: 0, uploadId: 'original-upload', version: 'a'.repeat(64), size: 4, fingerprint: seed.fingerprint }
					},
					{ ordinal: 1, status: 'failed', statusCode: 403, code: 'authority-changed', retryable: false }
				],
				payloads: [
					{ ordinal: 0, bytes: 4 },
					{ ordinal: 1, bytes: 0 }
				]
			}),
			{
				currentScope: () => scope,
				origin: () => scope.origin,
				requireCapability: async () => {},
				fetch: async () => {
					posted = true;
					throw Error('No canonical mutation allowed');
				}
			},
			new AbortController().signal,
			{
				markCommit: async () => {
					marked = true;
				},
				confirm: async () => {
					throw Error('No synthetic receipt');
				}
			}
		),
		/authority-changed/
	);
	assert.equal(marked, false);
	assert.equal(posted, false);
	assert.equal((await f.runs().active())!.progress.confirmed, 0);
	f.f.journal().close();
});
