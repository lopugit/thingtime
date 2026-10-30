import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executeCloudFolderBatch } from './cloudFolderBatch.client';
import { folderBatchDigest, type FolderBatchDescriptor, type NativeFolderBatch } from './folderBatch';
const seed = JSON.parse(readFileSync(new URL('./fixtures/folderBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0]
	.descriptor as FolderBatchDescriptor;
function fixture() {
	const d = structuredClone(seed);
	d.members = d.members.slice(0, 1);
	const parent = d.members[0];
	assert.equal(parent.write.operation.mutation.kind, 'copy');
	if (parent.write.operation.mutation.kind !== 'copy') throw Error('copy');
	const child = structuredClone(parent);
	if (child.write.operation.mutation.kind !== 'copy') throw Error('copy');
	child.ordinal = 1;
	child.parent = { kind: 'member', ordinal: 0 };
	child.write.operation.id = crypto.randomUUID();
	child.write.operation.mutation.path = child.write.operation.mutation.source.path = parent.write.operation.mutation.path + '/Child';
	child.write.operation.mutation.source.id = 'child-inode';
	child.write.folderId = parent.write.operation.id;
	d.members.push(child);
	let nativeCalls = 0,
		mutations = 0,
		commits = 0,
		sourceChanged = false,
		lost = false,
		changed = false;
	const confirmed: number[] = [],
		dispatch: number[][] = [],
		receipts = new Map<number, any>();
	const envelope = async (input: any, results: any[]) => ({
		ok: true as const,
		version: 1 as const,
		batchId: d.batchId,
		digest: await folderBatchDigest(d),
		results
	});
	const result = (ordinal: number) => ({
		ordinal,
		status: 'confirmed',
		folder: {
			id: d.members[ordinal].write.operation.id,
			name: d.members[ordinal].write.operation.mutation.path.split('/').at(-1),
			folderId: d.members[ordinal].write.folderId,
			revision: 'r1'
		},
		replayed: false
	});
	const runtime = {
		currentScope: () => d.scope,
		origin: () => d.scope.origin,
		requireCapability: async () => {},
		authorizeMutation: async () => {
			mutations++;
			if (changed) throw Error('Configuration changed');
		},
		fetch: async (_url: any, init: any) => {
			const body = JSON.parse(init.body);
			if (body.phase === 'folder-probe')
				return Response.json(
					await envelope(
						body,
						d.members.map(({ ordinal }) =>
							receipts.get(ordinal) ? { ...receipts.get(ordinal), replayed: true } : { ordinal, status: 'source-required' }
						)
					)
				);
			commits++;
			for (const ordinal of body.ordinals) receipts.set(ordinal, result(ordinal));
			if (lost) throw Error('Lost canonical reply');
			return Response.json(
				await envelope(
					body,
					body.ordinals.map((i: number) => receipts.get(i))
				)
			);
		}
	};
	const native: NativeFolderBatch = async (input) => {
		nativeCalls++;
		return envelope(
			input,
			input.ordinals.map((ordinal: number) =>
				sourceChanged && ordinal === 0 ? { ordinal, status: 'failed', code: 'source-changed', retryable: false } : { ordinal, status: 'validated' }
			)
		);
	};
	const callbacks = {
		markCommit: async (ordinals: number[]) => {
			dispatch.push(ordinals);
		},
		confirm: async (receipt: any) => {
			confirmed.push(d.members.findIndex((m) => m.write.operation.id === receipt.operationId));
		}
	};
	return {
		d,
		runtime,
		native,
		callbacks,
		receipts,
		result,
		confirmed,
		dispatch,
		counters: () => ({ nativeCalls, mutations, commits }),
		sourceChanged: () => {
			sourceChanged = true;
		},
		lose: () => {
			lost = true;
		},
		change: () => {
			changed = true;
		}
	};
}
test('folder receipt probe replays accepted history before deleted local source IO', async () => {
	const f = fixture();
	for (const member of f.d.members) f.receipts.set(member.ordinal, f.result(member.ordinal));
	assert.deepEqual(await executeCloudFolderBatch(f.d, f.native, f.runtime, new AbortController().signal, f.callbacks), []);
	assert.deepEqual(f.confirmed, [0, 1]);
	assert.deepEqual(f.counters(), { nativeCalls: 0, mutations: 0, commits: 0 });
	assert.deepEqual(f.dispatch, []);
});
test('changed parent blocks dependent suffix without fabricated canonical confirmation', async () => {
	const f = fixture();
	f.sourceChanged();
	const failed = await executeCloudFolderBatch(f.d, f.native, f.runtime, new AbortController().signal, f.callbacks);
	assert.deepEqual(
		failed.map((r) => [r.ordinal, r.code]),
		[
			[0, 'source-changed'],
			[1, 'dependency-unavailable']
		]
	);
	assert.deepEqual(f.confirmed, []);
	assert.equal(f.counters().commits, 0);
});
test('lost folder commit reply keeps original IDs and receipt-first recovery avoids native source IO', async () => {
	const f = fixture();
	f.lose();
	await assert.rejects(executeCloudFolderBatch(f.d, f.native, f.runtime, new AbortController().signal, f.callbacks));
	assert.deepEqual(f.dispatch, [[0, 1]]);
	assert.equal(f.receipts.size, 2);
	await executeCloudFolderBatch(f.d, f.native, f.runtime, new AbortController().signal, f.callbacks);
	assert.deepEqual(f.confirmed, [0, 1]);
	assert.equal(f.counters().nativeCalls, 1);
	assert.equal(f.counters().commits, 1);
});
test('fresh config guard and expired validation cannot reach canonical dispatch', async () => {
	const f = fixture();
	f.change();
	await assert.rejects(executeCloudFolderBatch(f.d, f.native, f.runtime, new AbortController().signal, f.callbacks), /Configuration/);
	assert.deepEqual(f.dispatch, []);
	assert.equal(f.counters().commits, 0);
	const expired = fixture();
	let clock = 0;
	const native: NativeFolderBatch = async (input, signal) => {
		const result = await expired.native(input, signal);
		clock = 30001;
		return result;
	};
	const runtime = {
		...expired.runtime,
		authorizeMutation: async () => {
			clock += 30001;
		}
	};
	await assert.rejects(
		executeCloudFolderBatch(expired.d, native, runtime, new AbortController().signal, { ...expired.callbacks, now: () => clock }),
		/expired/
	);
	assert.equal(expired.counters().commits, 0);
});
