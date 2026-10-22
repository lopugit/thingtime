import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { BatchAuthorityChanged, createFileBatchService, parseBatchRequest } from './batches';
import { createAttachmentService, attachmentIdForRequest } from '../attachments/attachments';
import { uploadBatchCanonicalBytes } from '../../../fileSync/uploadBatch';
const vectors = JSON.parse(readFileSync(new URL('../../../fileSync/fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors;
const raw = 'a'.repeat(64),
	fp = createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex');
const digest = (d: any) => createHash('sha256').update(uploadBatchCanonicalBytes(d)).digest('hex');
function fixture(count = 1, overrides: any = {}) {
	const d = structuredClone(vectors[0].descriptor),
		seed = d.members[0];
	d.members = Array.from({ length: count }, (_, ordinal) => {
		const m = structuredClone(seed);
		m.ordinal = ordinal;
		m.write.operation.id = randomUUID();
		m.write.operation.mutation.path = m.write.operation.mutation.source.path = `Parent/f${ordinal}`;
		m.write.operation.mutation.source.id = `inode${ordinal}`;
		m.write.operation.mutation.source.fingerprint.sha256 = fp;
		return m;
	});
	let stored = false,
		observeCalls = 0,
		receiptCalls = 0;
	let authorizations = 0,
		starts: any[] = [],
		completed: any[] = [],
		signed: any[] = [],
		commits: any[] = [],
		ready = false,
		failOrdinal = -1,
		revoked = false,
		revokeOnStart = false,
		finalizing = false;
	const receipts = new Map<string, any>();
	const content = (id: string) => ({ id, version: 'b'.repeat(64), size: 4, fingerprint: d.members[0].write.operation.mutation.source.fingerprint });
	const file = (write: any) => ({
		id: write.operation.id,
		revision: 'revision',
		name: write.operation.mutation.path.split('/').at(-1),
		folderId: write.folderId,
		trashed: false,
		content: { attachmentId: attachmentIdForRequest('owner', write.operation.id), ...content('x') }
	});
	const service = createFileBatchService({
		observe: async (_owner, _root, paths) => (
			observeCalls++,
			{
				ok: true,
				version: 1,
				observations: paths.map((path) => ({
					path,
					node: null,
					parent: { kind: 'folder', id: 'cloud-parent', path: 'Parent', folderId: 'cloud-root', revision: 'revision' }
				}))
			}
		),
		ownedUpload: async () =>
			finalizing ? ({ attachmentState: 'finalizing', attachmentPurpose: 'file', objectSizeBytes: 4, crystal: { name: 'f0' } } as any) : null,
		authorize: async () => {
			authorizations++;
			if (revoked) throw new BatchAuthorityChanged();
		},
		charge: async () => true,
		start: async (_owner, input: any) => {
			starts.push(input);
			if (revokeOnStart) revoked = true;
			return { ok: true, upload: { id: attachmentIdForRequest('owner', input.requestId), partSizeBytes: 8388608, partCount: 1 } };
		},
		sign: async (_owner, input: any) => {
			signed.push(input);
			return { ok: true, parts: [{ partNumber: 1, url: 'https://storage.test/part', expiresAt: '2026-10-22', headers: {} }] };
		},
		complete: async (_owner, input: any) => {
			completed.push(input);
			if (input.uploadId === attachmentIdForRequest('owner', d.members[failOrdinal]?.write.operation.id ?? ''))
				return { ok: false, status: 409, error: 'active lease', retryable: true };
			stored = true;
			return { ok: true, attachment: {} };
		},
		fingerprint: async (_viewer, id: any) => (ready || stored ? { ok: true, ...content(id) } : { ok: false, status: 404, error: 'not ready' }),
		files: {
			readReceipts: async (_owner, rows: any[]) => (
				receiptCalls++,
				{
					ok: true,
					receipts: rows.map((r) => (receipts.has(r.id) ? { file: receipts.get(r.id) } : null))
				}
			),
			read: async (_owner, id: any) => ({ ok: true, receipt: receipts.has(id) ? { file: receipts.get(id) } : null }),
			commit: async (_owner, input: any) => {
				commits.push(input);
				const value = file(d.members.find((m: any) => m.write.operation.id === input.id).write);
				receipts.set(input.id, value);
				return { ok: true, file: value, replayed: false };
			}
		} as any,
		...overrides
	});
	const run = (phase: string, rows: any[] = [], signal = new AbortController().signal) =>
		service(
			'owner',
			'https://sync.test',
			{ phase, descriptor: d, digest: digest(d), [phase === 'prepare' ? 'checksums' : phase === 'verify' ? 'uploads' : 'contents']: rows },
			signal
		);
	const ids = () => d.members.map((m: any) => ({ ordinal: m.ordinal, uploadId: attachmentIdForRequest('owner', m.write.operation.id) }));
	return {
		d,
		run,
		ids,
		starts,
		signed,
		completed,
		commits,
		receipts,
		file,
		content,
		revoke() {
			revoked = true;
		},
		revokeOnStart() {
			revokeOnStart = true;
		},
		ready() {
			ready = true;
		},
		finalizing() {
			finalizing = true;
		},
		fail(i: number) {
			failOrdinal = i;
		},
		get observeCalls() {
			return observeCalls;
		},
		get receiptCalls() {
			return receiptCalls;
		},
		get authorizations() {
			return authorizations;
		}
	};
}
test('closed parser verifies canonical digest and ordinal/upload identity binding', () => {
	const d = structuredClone(vectors[0].descriptor);
	const request = { phase: 'prepare', descriptor: d, digest: digest(d), checksums: [] };
	assert.equal(parseBatchRequest(request).phase, 'prepare');
	for (const alter of [
		(v: any) => (v.digest = 'f'.repeat(64)),
		(v: any) => (v.permit = true),
		(v: any) =>
			(v.checksums = [
				{ ordinal: 0, sha256: raw },
				{ ordinal: 0, sha256: raw }
			]),
		(v: any) => {
			v.phase = 'verify';
			delete v.checksums;
			v.uploads = [{ ordinal: 0, uploadId: randomUUID() }];
		}
	]) {
		const v = structuredClone(request);
		alter(v);
		assert.throws(() => parseBatchRequest(v));
	}
});
test('receipt-only probe does no provider work and replays despite unavailable source', async () => {
	const f = fixture(2);
	f.receipts.set(f.d.members[0].write.operation.id, f.file(f.d.members[0].write));
	const result: any = await f.run('prepare');
	assert.deepEqual(
		result.results.map((r: any) => r.status),
		['confirmed', 'source-required']
	);
	assert.equal(f.starts.length + f.signed.length + f.completed.length, 0);
});
test('prepare signs only raw digests bound to original indexed one-part fingerprint', async () => {
	const f = fixture(2);
	const r: any = await f.run('prepare', [
		{ ordinal: 0, sha256: raw },
		{ ordinal: 1, sha256: 'f'.repeat(64) }
	]);
	assert.deepEqual(
		r.results.map((r: any) => r.status),
		['prepared', 'failed']
	);
	assert.equal(f.starts.length, 1);
	assert.equal(f.starts[0].requestId, f.d.members[0].write.operation.id);
	assert.equal(f.signed[0].parts[0].checksumSha256, Buffer.from(raw, 'hex').toString('base64'));
});
test('ready original upload stamps exact provenance without another PUT', async () => {
	const f = fixture();
	f.ready();
	const r: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.results[0].status, 'verified');
	assert.equal(f.starts.length, 1);
	assert.equal(f.starts[0].fileSyncOrigin.path, f.d.members[0].write.operation.mutation.path);
	assert.equal(f.starts[0].fileSyncOrigin.localRootId, f.d.scope.rootId);
	assert.equal(r.results[0].content.uploadId, f.ids()[0].uploadId);
});
test('active complete lease keeps partial success independent and retry preserves IDs', async () => {
	const f = fixture(2);
	f.fail(0);
	let r: any = await f.run('verify', f.ids());
	assert.deepEqual(
		r.results.map((r: any) => r.status),
		['failed', 'verified']
	);
	assert.equal(r.results[0].retryable, true);
	f.fail(-1);
	r = await f.run('verify', f.ids());
	assert.equal(r.results[0].status, 'verified');
	assert.equal(f.completed[0].uploadId, f.completed[2].uploadId);
});
test('canonical commit publishes originals and lost reply replays immutable receipt', async () => {
	const f = fixture();
	const rows = f.ids().map((id) => ({ ...id, version: 'b'.repeat(64), size: 4, fingerprint: f.content(id.uploadId).fingerprint }));
	let r: any = await f.run('commit', rows);
	assert.equal(r.results[0].status, 'confirmed');
	assert.equal(f.commits[0].id, f.d.members[0].write.operation.id);
	assert.equal(f.commits[0].expectedRevision, null);
	r = await f.run('commit', rows);
	assert.equal(r.results[0].replayed, true);
	assert.equal(f.commits.length, 1);
});
test('fresh authority failure dispatches no provider actions', async () => {
	const f = fixture();
	f.revoke();
	const r: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.status, 403);
	assert.equal(f.starts.length, 0);
});

test('observed authority drift stops subsequent waves while preserving partial outcomes', async () => {
	const f = fixture(24);
	f.revokeOnStart();
	const r: any = await f.run(
		'prepare',
		f.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw }))
	);
	assert.ok(f.starts.length > 0 && f.starts.length <= 8);
	assert.equal(r.results.length, 24);
	assert.ok(r.results.some((item: any) => item.code === 'authority-changed'));
});

test('restarted prepare recovers original finalizing upload through canonical complete lease path', async () => {
	const f = fixture();
	f.finalizing();
	f.fail(0);
	let r: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.results[0].status, 'failed');
	assert.equal(r.results[0].retryable, true);
	assert.equal(f.starts.length, 1);
	f.fail(-1);
	r = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.results[0].status, 'verified');
	assert.equal(f.completed[0].uploadId, f.completed[1].uploadId);
	assert.equal(f.starts.length, 2);
});

test('batch recovery uses actual attachment lease and exact-version stored fingerprint services', async () => {
	let doc: any;
	let heads = 0;
	const attachments = createAttachmentService({
		customMongoActive: () => false,
		store: { getOwned: async () => doc, getById: async () => doc, claimFinalizing: async () => ({ doc, acquired: false }) } as any,
		getS3: () =>
			({
				headObject: async ({ versionId }: any) => {
					heads++;
					assert.equal(versionId, 'stored-version');
					return {
						sizeBytes: 4,
						attachmentId: doc.shareId,
						versionId: 'stored-version',
						checksumType: 'COMPOSITE',
						checksumSha256: Buffer.from(fp, 'hex').toString('base64') + '-1'
					};
				}
			} as any)
	});
	const f = fixture(1, { complete: attachments.complete, fingerprint: attachments.fingerprint, ownedUpload: async () => doc });
	doc = {
		shareId: f.ids()[0].uploadId,
		ownerId: 'owner',
		thingtime: ['attachment'],
		attachmentState: 'finalizing',
		attachmentPurpose: 'file',
		crystal: { name: 'f0', size: 4, contentType: 'application/octet-stream', mediaKind: 'file' },
		objectKey: 'objects/original',
		objectSizeBytes: 4,
		objectVersionId: 'stored-version',
		uploadId: 'original-mpu'
	};
	let r: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.results[0].code, 'temporarily-unavailable');
	assert.equal(r.results[0].retryable, true);
	assert.equal(heads, 0);
	doc.attachmentState = 'ready';
	r = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(r.results[0].status, 'verified');
	assert.equal(r.results[0].content.fingerprint.sha256, fp);
	assert.equal(heads, 1);
	assert.equal(f.starts.length, 2);
});

test('cancellation between provider calls stops signing and retains original reserved identity', async () => {
	const controller = new AbortController();
	let reserved = '';
	const f = fixture(1, {
		start: async (owner: string, input: any) => {
			reserved = attachmentIdForRequest(owner, input.requestId);
			controller.abort();
			return { ok: true, upload: { id: reserved, partSizeBytes: 8388608, partCount: 1 } };
		}
	});
	const r: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }], controller.signal);
	assert.equal(r.results[0].code, 'cancelled');
	assert.equal(f.signed.length, 0);
	assert.equal(reserved, f.ids()[0].uploadId);
});

test('transient authority observation errors stay retryable and do not leak details', async () => {
	const f = fixture(1, {
		authorize: async () => {
			throw Error('private database endpoint secret');
		}
	});
	const result: any = await f.run('prepare', [{ ordinal: 0, sha256: raw }]);
	assert.equal(result.status, 503);
	assert.ok(!JSON.stringify(result).includes('secret'));
	let calls = 0;
	const g = fixture(24, {
		authorize: async () => {
			if (++calls === 3) throw Error('network unavailable');
		}
	});
	const wave: any = await g.run(
		'prepare',
		g.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw }))
	);
	assert.equal(wave.results[0].status, 'prepared');
	assert.equal(wave.results[8].statusCode, 503);
	assert.equal(wave.results[8].retryable, true);
	assert.equal(g.starts.length, 8);
});

test('oversized prepared grants become bounded independent failures with original uploads retained', async () => {
	const f = fixture(2, {
		sign: async (_owner: any, input: any) => ({
			ok: true,
			parts: [
				{
					partNumber: 1,
					url: input.uploadId.endsWith('x') ? 'https://small.test' : 'https://large.test/' + 'x'.repeat(2 * 1024 * 1024),
					expiresAt: '2026-10-22',
					headers: {}
				}
			]
		})
	});
	const result: any = await f.run(
		'prepare',
		f.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw }))
	);
	assert.equal(result.ok, true);
	assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2 * 1024 * 1024);
	assert.ok(result.results.every((r: any) => r.status === 'failed' && r.retryable));
	assert.equal(f.starts.length, 2);
});

test('256-member dispatch uses33fresh authority observations and32shared namespace/receipt waves', async () => {
	const f = fixture(256);
	const r: any = await f.run(
		'prepare',
		f.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw }))
	);
	assert.equal(r.results.filter((item: any) => item.status === 'prepared').length, 256);
	assert.equal(f.authorizations, 33);
	assert.equal(f.observeCalls, 32);
	assert.equal(f.receiptCalls, 32);
	assert.equal(f.starts.length, 256);
});

test('terminal canonical upload refusal stops all subsequent waves and signing', async () => {
	let starts = 0;
	const f = fixture(24, {
		start: async () => {
			starts++;
			return { ok: false, status: 403, error: 'uploads revoked' };
		}
	});
	const r: any = await f.run(
		'prepare',
		f.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw }))
	);
	assert.ok(starts > 0 && starts <= 8);
	assert.equal(f.signed.length, 0);
	assert.ok(r.results.every((item: any) => item.code === 'authority-changed' && !item.retryable));
});

test('mixed confirmed/ready/source-failed/PUT members preserve sparse verify and commit wire', async () => {
	const stored = new Set<string>(),
		completed: string[] = [];
	const f = fixture(4, {
		fingerprint: async (_viewer: any, id: string) =>
			stored.has(id) ? { ok: true, ...f.content(id) } : { ok: false, status: 404, error: 'not ready' },
		complete: async (_owner: any, input: any) => {
			completed.push(input.uploadId);
			stored.add(input.uploadId);
			return { ok: true, attachment: {} };
		}
	});
	f.receipts.set(f.d.members[0].write.operation.id, f.file(f.d.members[0].write));
	stored.add(f.ids()[1].uploadId);
	const prepared: any = await f.run('prepare', [
		{ ordinal: 1, sha256: raw },
		{ ordinal: 2, sha256: 'f'.repeat(64) },
		{ ordinal: 3, sha256: raw }
	]);
	assert.deepEqual(
		prepared.results.map((r: any) => r.status),
		['confirmed', 'verified', 'failed', 'prepared']
	);
	const verified: any = await f.run('verify', [f.ids()[3]]);
	assert.deepEqual(
		verified.results.map((r: any) => r.ordinal),
		[3]
	);
	assert.deepEqual(completed, [f.ids()[3].uploadId]);
	const committed: any = await f.run('commit', [prepared.results[1].content, verified.results[0].content]);
	assert.deepEqual(
		committed.results.map((r: any) => r.ordinal),
		[1, 3]
	);
	assert.ok(committed.results.every((r: any) => r.status === 'confirmed'));
	assert.deepEqual(
		f.commits.map((r) => r.id),
		[f.d.members[1].write.operation.id, f.d.members[3].write.operation.id]
	);
	const empty: any = await f.run('verify', []);
	assert.deepEqual(empty.results, []);
	assert.equal(completed.length, 1);
});

test('verify and commit subsets require ascending unique ordinals', async () => {
	const f = fixture(3);
	const result: any = await f.run('verify', [f.ids()[2], f.ids()[0]]);
	assert.equal(result.status, 400);
	assert.equal(f.completed.length, 0);
});

test('server accepts legacy V1 no-ignore configuration consistently for probe and observe', async () => {
	const f = fixture();
	f.d.configuration.configuration.configurationVersion = 1;
	delete f.d.configuration.configuration.ignoreRules;
	const result: any = await f.run('prepare', []);
	assert.equal(result.ok, true);
	assert.equal(result.results[0].status, 'source-required');
});

test('configuration3 transfer ceiling bounds actual concurrent provider members without changing IDs', async () => {
 for (const ceiling of [1, 2, 100]) {
  let active = 0, peak = 0;
  const f = fixture(12, { admit: async (_owner: string, _signal: AbortSignal, _deadline: number, work: () => Promise<unknown>) => {
   active++; peak = Math.max(peak, active);
   try { await new Promise(resolve => setImmediate(resolve)); return await work(); }
   finally { active--; }
  } });
  f.d.configuration.configuration.configurationVersion = 3;
  f.d.configuration.configuration.resourceLimits = { transferConcurrency: ceiling };
  const ids = f.d.members.map((m: any) => m.write.operation.id);
  const result = await f.run('prepare', f.d.members.map((m: any) => ({ ordinal: m.ordinal, sha256: raw })));
  assert.equal(result.ok, true);
  assert.equal(peak, Math.min(8, ceiling));
  assert.equal(active, 0);
  assert.deepEqual(f.d.members.map((m: any) => m.write.operation.id), ids);
 }
});
