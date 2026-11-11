import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { folderBatchCanonicalBytes } from '../../../fileSync/folderBatch';
import { createFolderBatchService, parseFolderBatchRequest } from './folderBatches';
import { BatchAuthorityChanged } from './batchAuthority';
const vectors = JSON.parse(readFileSync(new URL('../../../fileSync/fixtures/folderBatchDigest.v1.json', import.meta.url), 'utf8'));
const vector = Array.isArray(vectors) ? vectors[0] : vectors.vectors[0];
const digest = (d: any) => createHash('sha256').update(folderBatchCanonicalBytes(d)).digest('hex');
function fixture(overrides: Parameters<typeof createFolderBatchService>[0] = {}, afterWave: () => void = () => {}) {
	const d = structuredClone(vector.descriptor),
		receipts = new Map<string, any>();
	let waves = 0,
		authorizations = 0,
		moved = false,
		failWave = 0;
	const service = createFolderBatchService({
		authorize: async () => {
			authorizations++;
		},
		charge: async () => true,
		folders: {
			readReceipts: async (_o: any, rows: any[]) => ({ ok: true, receipts: rows.map((r) => receipts.get(r.id) ?? null) }),
			createWave: async (_o: any, inputs: any[], options: any) => {
				waves++;
				if (failWave === waves) return { ok: false, status: 503, error: 'unknown' };
				const denied = await options.beforeWrite({}, {}, inputs);
				const result = {
					ok: true,
					results: inputs.map((input) => {
						if (denied.has(input.id)) return { ok: false, ...denied.get(input.id) };
						const folder = { id: input.id, folderId: input.folderId, name: input.name, revision: 'folder-revision' };
						receipts.set(input.id, folder);
						return { ok: true, folder, replayed: false };
					})
				};
				afterWave();
				return result;
			}
		} as any,
		observe: async (_t, _s, _o, _r, paths) => ({
			ok: true,
			version: 1,
			observations: paths.map((path) => {
				const prefix = path.split('/').slice(0, -1).join('/'),
					member = d.members.find((m: any) => m.write.operation.mutation.path === prefix);
				return {
					path,
					node: null,
					parent:
						prefix && !moved
							? {
									kind: 'folder',
									path: prefix,
									id: member?.write.operation.id ?? 'external-parent',
									folderId: d.configuration.configuration.remoteFolderId,
									revision: 'r'
							  }
							: null
				};
			})
		}),
		...overrides
	});
	const run = (phase = 'folder-commit', ordinals = d.members.map((m: any) => m.ordinal), signal = new AbortController().signal) =>
		service(d.scope.ownerId, d.scope.origin, { phase, descriptor: d, digest: digest(d), ...(phase === 'folder-commit' ? { ordinals } : {}) }, signal);
	return {
		d,
		run,
		receipts,
		moved() {
			moved = true;
		},
		fail(n: number) {
			failWave = n;
		},
		get waves() {
			return waves;
		},
		get authorizations() {
			return authorizations;
		}
	};
}
test('frozen folder digest vectors parse through server closed phase parser', () => {
	for (const v of Array.isArray(vectors) ? vectors : vectors.vectors) {
		assert.equal(parseFolderBatchRequest({ phase: 'folder-probe', descriptor: v.descriptor, digest: digest(v.descriptor) }).phase, 'folder-probe');
	}
	const f = fixture();
	assert.throws(() => parseFolderBatchRequest({ phase: 'folder-commit', descriptor: f.d, digest: digest(f.d), ordinals: [1, 0] }));
});
test('dependency waves confirm parents before children and sparse commit returns selected only', async () => {
	const f = fixture();
	const r: any = await f.run();
	assert.ok(r.results.every((r: any) => r.status === 'confirmed'));
	assert.equal(f.waves, f.d.members.length);
	assert.equal(f.authorizations, 1 + f.waves);
	const replay: any = await f.run('folder-commit', [f.d.members.length - 1]);
	assert.equal(replay.results.length, 1);
	assert.equal(replay.results[0].replayed, true);
});
test('receipt-first probe does no folder writes, even with missing native sources', async () => {
	const f = fixture();
	await f.run();
	const before = f.waves;
	const probe: any = await f.run('folder-probe');
	assert.ok(probe.results.every((r: any) => r.status === 'confirmed'));
	assert.equal(f.waves, before);
});
test('historical parent receipt does not authorize moved current parent', async () => {
	const f = fixture();
	const first: any = await f.run('folder-commit', [0]);
	assert.equal(first.results[0].status, 'confirmed');
	f.moved();
	const child: any = await f.run('folder-commit', [1]);
	assert.equal(child.results[0].status, 'failed');
	assert.equal(f.receipts.has(f.d.members[1].write.operation.id), false);
});
test('wrong parent receipt ID blocks descendants without retargeting immutable writes', async () => {
	const f = fixture(),
		m = f.d.members[0];
	f.receipts.set(m.write.operation.id, { id: 'wrong', folderId: m.write.folderId, name: m.write.operation.mutation.path, revision: 'r' });
	const r: any = await f.run('folder-commit', [1]);
	assert.equal(r.results[0].code, 'dependency-unavailable');
	assert.equal(f.waves, 0);
});
test('failed later wave retains earlier committed receipts and returns exact subset failures', async () => {
	const f = fixture();
	f.fail(2);
	const r: any = await f.run();
	assert.equal(r.results[0].status, 'confirmed');
	assert.ok(r.results.slice(1).every((r: any) => r.status === 'failed'));
	assert.equal(f.receipts.size, 1);
});
test('actual policy revocation is403 but storage observation failure is503', async () => {
	const f = fixture();
	for (const [error, status] of [
		[new BatchAuthorityChanged(), 403],
		[Error('private endpoint'), 503]
	] as const) {
		const service = createFolderBatchService({
			authorize: async () => {
				throw error;
			}
		});
		const r: any = await service(
			f.d.scope.ownerId,
			f.d.scope.origin,
			{ phase: 'folder-probe', descriptor: f.d, digest: digest(f.d) },
			new AbortController().signal
		);
		assert.equal(r.status, status);
		assert.ok(!JSON.stringify(r).includes('endpoint'));
	}
});

test('request row exhaustion fails closed before any canonical write', async () => {
	const f = fixture({
		observe: async (_t, _s, _o, _r, _paths, _signal, row) => {
			for (let i = 0; i < 65537; i++) row();
			throw Error('unreachable');
		}
	});
	const r: any = await f.run();
	assert.equal(r.ok, false);
	assert.equal(r.status, 503);
	assert.equal(f.receipts.size, 0);
});
test('aborted request does not dispatch a canonical wave', async () => {
	const f = fixture();
	const controller = new AbortController();
	controller.abort();
	const service = createFolderBatchService({
		authorize: async () => {
			throw Error('must not authorize');
		}
	});
	const r: any = await service(
		f.d.scope.ownerId,
		f.d.scope.origin,
		{ phase: 'folder-probe', descriptor: f.d, digest: digest(f.d) },
		controller.signal
	);
	assert.equal(r.status, 503);
	assert.equal(f.waves, 0);
});

test('policy revoked between dependency waves preserves the first receipt and dispatches no later create', async () => {
	const authorizationWaves: number[] = [];
	const f = fixture({
		authorize: async () => {
			authorizationWaves.push(f.waves);
			if (f.waves === 1) throw new BatchAuthorityChanged();
		}
	});
	const r: any = await f.run();
	assert.deepEqual(authorizationWaves, [0, 0, 1]);
	assert.equal(f.waves, 1);
	assert.equal(f.receipts.size, 1);
	assert.deepEqual(r.results[0], { ordinal: 0, status: 'confirmed', folder: f.receipts.get(f.d.members[0].write.operation.id), replayed: false });
	for (const result of r.results.slice(1))
		assert.deepEqual(result, { ordinal: result.ordinal, status: 'failed', code: 'authority-changed', statusCode: 403, retryable: false });
});

test('cancellation between dependency waves keeps accepted history and stops before another authorization or create', async () => {
	const controller = new AbortController();
	const f = fixture({}, () => controller.abort());
	const r: any = await f.run('folder-commit', undefined, controller.signal);
	assert.equal(f.authorizations, 2); // phase entry and the only dispatched wave
	assert.equal(f.waves, 1);
	assert.equal(f.receipts.size, 1);
	assert.equal(r.results[0].status, 'confirmed');
	assert.equal(r.results[0].folder, f.receipts.get(f.d.members[0].write.operation.id));
	for (const result of r.results.slice(1))
		assert.deepEqual(result, { ordinal: result.ordinal, status: 'failed', code: 'cancelled', statusCode: 503, retryable: false });
});

test('deadline after an accepted dependency wave keeps its receipt and dispatches no later work', async () => {
	let now = Date.now();
	const f = fixture({ now: () => now }, () => {
		now += 30001;
	});
	const r: any = await f.run();
	assert.equal(f.authorizations, 2);
	assert.equal(f.waves, 1);
	assert.equal(f.receipts.size, 1);
	assert.equal(r.results[0].status, 'confirmed');
	assert.equal(r.results[0].folder, f.receipts.get(f.d.members[0].write.operation.id));
	for (const result of r.results.slice(1))
		assert.deepEqual(result, { ordinal: result.ordinal, status: 'failed', code: 'temporarily-unavailable', statusCode: 503, retryable: true });
});
