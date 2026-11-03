/** Actual isolated Mongo canonical folder transactions and request handlers.
 * Synthetic local sources/account only; no S3/native/provider throughput claim. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const directory = process.env.THINGTIME_FILE_SYNC_FOLDER_BATCHES_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28168\/thingtime\?replicaSet=file-sync-folder-batches$/.test(process.env.MONGODB_CONNECTION_STRING || '')
);
const actual = await realpath(directory!);
assert.equal(dirname(actual), await realpath(tmpdir()));
assert.ok(basename(actual).startsWith('thingtime-file-sync-folder-batches-'));
assert.equal((await stat(actual)).mode & 0o077, 0);
const base = 'http://127.0.0.1:28168';
process.env.APP_URL = base;
process.env.JWT_SECRET = randomUUID() + randomUUID();
process.env.NODE_ENV = 'test';
const { action: register } = await import('../app/routes/api/v1/auth/register/_register');
const signed = await register({
	request: new Request(base + '/api/v1/auth/register', {
		method: 'POST',
		headers: { Origin: base, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: 'folders-' + randomUUID().slice(0, 8),
			email: randomUUID() + '@example.invalid',
			password: randomUUID() + '-Fixture!'
		})
	})
} as any);
assert.equal(signed.status, 200);
const owner = (await signed.json()).user.id,
	cookie = signed.headers
		.getSetCookie()
		.map((v) => v.split(';')[0])
		.join('; ');
const { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } = await import('../app/api/utils/mongodb/collections');
const { createThing } = await import('../app/api/utils/things/things');
const { cloudFolders, createCloudFolderService } = await import('../app/api/utils/files/folders');
const { getUserStorageUsage } = await import('../app/api/utils/storage/userStorage');
const { folderBatchCanonicalBytes } = await import('../app/fileSync/folderBatch');
const { action } = await import('../app/routes/api/v1/files/batches/_batches');
const { createFolderBatchService } = await import('../app/api/utils/files/folderBatches');
const { createBatchObserveService } = await import('../app/api/utils/files/batchObserve');
const things = await getHomeThingsCollection(),
	date = new Date(),
	rootId = randomUUID(),
	configurationId = randomUUID(),
	deviceId = randomUUID();
const root = await createThing(owner, { shareId: rootId, thingtime: ['folder'], crystal: { name: 'Root' }, acl: ['tt:user'] }, { id: owner }, null);
assert.equal(root.ok, true);
const vectors = JSON.parse(await readFile(new URL('../app/fileSync/fixtures/folderBatchDigest.v1.json', import.meta.url), 'utf8'));
const seed = (Array.isArray(vectors) ? vectors : vectors.vectors)[0].descriptor;
const c = { ...seed.configuration.configuration, deviceId, remoteFolderId: rootId };
await things.insertMany([
	{ shareId: configurationId, ownerId: owner, thingtime: ['file-sync'], acl: ['tt:user'], updatedAt: date, crystal: c },
	{ shareId: deviceId, ownerId: owner, thingtime: ['device'], updatedAt: date, crystal: {} }
] as any);
await (
	await getSessionsCollection()
).insertOne({
	jti: randomUUID(),
	userId: owner,
	purpose: 'device',
	meta: { deviceId },
	revokedAt: null,
	expiresAt: new Date(Date.now() + 600000)
} as any);
function descriptor(paths: string[], refs: any[]) {
	const d = structuredClone(seed);
	d.scope = { ...seed.scope, origin: base, ownerId: owner, rootId: configurationId, deviceId };
	d.configuration = { id: configurationId, updatedAt: date.toISOString(), configuration: c };
	const template = structuredClone(seed.members[0]);
	d.members = paths.map((path, ordinal) => {
		const m = structuredClone(template);
		m.ordinal = ordinal;
		m.parent = refs[ordinal];
		m.write.scope = d.scope;
		m.write.operation.id = randomUUID();
		m.write.cloudRootId = rootId;
		m.write.operation.mutation.path = m.write.operation.mutation.source.path = path;
		m.write.operation.mutation.source.id = 'fixture-inode-' + randomUUID();
		return m;
	});
	for (const m of d.members)
		m.write.folderId =
			m.parent.kind === 'root' ? rootId : m.parent.kind === 'existing' ? m.parent.id : d.members[m.parent.ordinal].write.operation.id;
	return d;
}
const digest = (d: any) => createHash('sha256').update(folderBatchCanonicalBytes(d)).digest('hex');
const body = (d: any, phase = 'folder-commit', ordinals = d.members.map((m: any) => m.ordinal)) => ({
	phase,
	descriptor: d,
	digest: digest(d),
	...(phase === 'folder-commit' ? { ordinals } : {})
});
async function call(d: any, phase = 'folder-commit', ordinals?: number[]) {
	const response = await action({
		request: new Request(base + '/api/v1/files/batches', {
			method: 'POST',
			headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
			body: JSON.stringify(body(d, phase, ordinals))
		})
	});
	assert.equal(response.status, 200);
	return response.json();
}
const started = performance.now();
const chain = descriptor(['P', 'P/C', 'P/C/G'], [{ kind: 'root' }, { kind: 'member', ordinal: 0 }, { kind: 'member', ordinal: 1 }]);
const probe: any = await call(chain, 'folder-probe');
assert.ok(probe.results.every((r: any) => r.status === 'source-required'));
const created: any = await call(chain);
assert.ok(created.results.every((r: any) => r.status === 'confirmed'));
const used = await getUserStorageUsage(owner);
const replay: any = await call(chain, 'folder-probe');
assert.ok(replay.results.every((r: any) => r.status === 'confirmed' && r.replayed));
assert.deepEqual(await getUserStorageUsage(owner), used);
// Eight independent members share one actual transaction; inner canonical
// createThing and placement locks still run for every member.
let waveTransactions = 0,
	waveCreates = 0;
const grouped = createCloudFolderService({
	transaction: async (work) => {
		waveTransactions++;
		return withHomeMongoTransaction(work);
	},
	create: async (...args: any[]) => {
		waveCreates++;
		return (createThing as any)(...args);
	}
});
const groupedInputs = Array.from({ length: 8 }, (_, i) => {
	const id = randomUUID();
	return { kind: 'folder', id, operationId: id, name: 'Wave-' + i, folderId: rootId };
});
const groupedStarted = performance.now();
const groupedResult = await grouped.createWave(owner, groupedInputs);
assert.equal(groupedResult.ok, true);
assert.equal(waveTransactions, 1);
assert.equal(waveCreates, 8);
const groupedElapsedMs = Math.round(performance.now() - groupedStarted);
// Actual transaction rollback after the second canonical create has mutated
// quota/content/Timeline, with original lock/create implementations intact.
let inserts = 0;
const rollback = createCloudFolderService({
	create: async (...args: any[]) => {
		const result = await (createThing as any)(...args);
		if (++inserts === 2) throw Error('fixture after-insert failure');
		return result;
	}
});
const rollbackInputs = ['R1', 'R2'].map((name) => ({ kind: 'folder', id: randomUUID(), operationId: randomUUID(), name, folderId: rootId }));
const beforeRollback = await getUserStorageUsage(owner);
const rolled: any = await rollback.createWave(owner, rollbackInputs);
assert.equal(rolled.ok, false);
for (const input of rollbackInputs) assert.equal(await things.findOne({ shareId: input.id }), null);
assert.deepEqual(await getUserStorageUsage(owner), beforeRollback);
const rollbackReceipts = await cloudFolders.readReceipts(owner, rollbackInputs);
assert.equal(rollbackReceipts.ok, true);
if (rollbackReceipts.ok) assert.ok(rollbackReceipts.receipts.every((r) => r === null));
// Lost reply AFTER real commit remains recoverable without duplicate quota.
const lost = createCloudFolderService({
	transaction: async (work) => {
		await withHomeMongoTransaction(work);
		throw Error('fixture lost commit reply');
	}
});
const unknown = { kind: 'folder', id: randomUUID(), operationId: randomUUID(), name: 'Unknown', folderId: rootId };
const lostResult: any = await lost.createWave(owner, [unknown]);
assert.equal(lostResult.ok, false);
const afterUnknown = await getUserStorageUsage(owner);
const recovered: any = await cloudFolders.createWave(owner, [unknown]);
assert.equal(recovered.results[0].replayed, true);
assert.deepEqual(await getUserStorageUsage(owner), afterUnknown);
// Current placement is required even when immutable parent history is valid.
const moved = descriptor(['Moved', 'Moved/Blocked'], [{ kind: 'root' }, { kind: 'member', ordinal: 0 }]);
assert.equal((await call(moved, 'folder-commit', [0])).results[0].status, 'confirmed');
const outside = await createThing(
	owner,
	{ shareId: randomUUID(), thingtime: ['folder'], crystal: { name: 'Outside' }, acl: ['tt:user'] },
	{ id: owner },
	null
);
assert.equal(outside.ok, true);
await things.updateOne({ shareId: moved.members[0].write.operation.id }, { $set: { folderId: outside.doc.shareId } });
const blocked: any = await call(moved, 'folder-commit', [1]);
assert.equal(blocked.results[0].status, 'failed');
assert.equal(await things.findOne({ shareId: moved.members[1].write.operation.id }), null);
await things.updateOne({ shareId: moved.members[0].write.operation.id }, { $set: { folderId: rootId, 'crystal.trashed': true } });
assert.equal((await call(moved, 'folder-commit', [1])).results[0].status, 'failed');
// Restore the unrelated fixture after its fail-closed trash assertion; the
// existing inventory gate intentionally rejects a trashed folder in namespace.
await things.updateOne(
	{ shareId: moved.members[0].write.operation.id },
	{ $set: { folderId: outside.doc.shareId }, $unset: { 'crystal.trashed': '' } }
);
// A generic scalar folder may have different folder/op IDs. A member ref must
// never adopt that actual ID; an explicit existing ref may use it safely.
const actualId = randomUUID(),
	originalOp = randomUUID();
assert.equal(
	(await cloudFolders.create(owner, { kind: 'folder', id: actualId, operationId: originalOp, name: 'Existing', folderId: rootId })).ok,
	true
);
const mismatch = descriptor(['Existing', 'Existing/NoRetarget'], [{ kind: 'root' }, { kind: 'member', ordinal: 0 }]);
mismatch.members[0].write.operation.id = originalOp;
mismatch.members[1].write.folderId = originalOp;
assert.equal((await call(mismatch, 'folder-commit', [1])).results[0].code, 'dependency-unavailable');
assert.equal(await things.findOne({ shareId: mismatch.members[1].write.operation.id }), null);
const existing = descriptor(['Existing/Allowed'], [{ kind: 'existing', id: actualId }]);
assert.equal((await call(existing)).results[0].status, 'confirmed');
// Shared namespace frontier is measured on real Mongo, not inferred from HTTP.
let rows = 0;
const observed = await createBatchObserveService({
	row: () => {
		rows++;
	}
})(owner, rootId, ['P/C/G', 'Existing/Allowed'], new AbortController().signal);
assert.equal(observed.ok, true);
console.log(
	JSON.stringify({
		fileSyncFolderBatchesProof: true,
		canonicalHttpPhases: true,
		parentBeforeChild: true,
		exactReceiptReplay: true,
		wholeWaveRollback: true,
		quotaRollback: true,
		unknownCommitRecovered: true,
		currentMovedOrTrashedParentBlocked: true,
		wrongMemberIdNotRetargeted: true,
		existingActualParentAllowed: true,
		namespaceRowsObserved: rows,
		eightCanonicalCreatesInOneTransaction: waveTransactions === 1 && waveCreates === 8,
		groupedElapsedMs,
		elapsedMs: Math.round(performance.now() - started),
		nativeAndProviderThroughput: false
	})
);
process.exit(0);
