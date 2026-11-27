import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { Binary } from 'mongodb';
import { randomUUID } from 'node:crypto';

// Deterministic coordinator/auth boundary tests. Collection doubles prove the
// query/CAS contract only; replica-set API acceptance remains a separate gate.
let rows: any[] = [], sessionRows: any[] = [], clock = Date.parse('2026-11-06T00:00:00Z');
let customPlane = false, failAfterWrite = false, loseCommitReply = false;
const clone = (v: any): any => v instanceof Binary ? new Binary(Buffer.from(v.value())) : v instanceof Date ? new Date(v) :
	Array.isArray(v) ? v.map(clone) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v;
const matches = (row: any, filter: any): boolean => Object.entries(filter).every(([key, expected]: any) => {
	if (key === '$or') return expected.some((part: any) => matches(row, part));
	const value = key.split('.').reduce((v: any, part: string) => v?.[part], row);
	if (expected && typeof expected === 'object' && expected.$type === 'date') return value instanceof Date;
	if (expected && typeof expected === 'object' && '$gt' in expected) return value > expected.$gt;
	return Array.isArray(value) ? value.includes(expected) : value === expected;
});
const collection = (get: () => any[]) => ({
	findOne: async (filter: any) => clone(get().find(row => matches(row, filter)) ?? null),
	insertOne: async (row: any) => { get().push(clone(row)); return { insertedId: row.shareId }; },
	updateOne: async (filter: any, update: any) => {
		const row = get().find(row => matches(row, filter));
		if (!row) return { matchedCount: 0, modifiedCount: 0 };
		Object.assign(row, clone(update.$set ?? {}));
		for (const key of Object.keys(update.$unset ?? {})) delete row[key];
		if (failAfterWrite && update.$set?.backupCursor) { failAfterWrite = false; throw Error('injected storage failure'); }
		return { matchedCount: 1, modifiedCount: 1 };
	}
});
const things = collection(() => rows), sessions = collection(() => sessionRows);
let lock = Promise.resolve();
const transaction = async <T>(work: (session: any) => Promise<T>): Promise<T> => {
	let release!: () => void; const previous = lock; lock = new Promise<void>(resolve => { release = resolve; }); await previous;
	const oldRows = clone(rows), oldSessions = clone(sessionRows);
	try {
		let result: T;
		try { result = await work({ inTransaction: () => true }); }
		catch (error) { rows = oldRows; sessionRows = oldSessions; throw error; }
		if (loseCommitReply) { loseCommitReply = false; throw Error('injected lost commit reply'); }
		return result;
	} finally { release(); }
};
mock.module('../mongodb/collections', { namedExports: {
	getHomeThingsCollection: async () => things, getSessionsCollection: async () => sessions, withHomeMongoTransaction: transaction
} });
mock.module('../mongodb/endpoint', { namedExports: { isCustomMongoEndpointActive: () => customPlane } });
mock.module('../auth/authCookie', { namedExports: { getAuthToken: async (request: Request) => request.headers.get('authorization')?.replace('Bearer ', '') ?? null } });
mock.module('../auth/jwt', { namedExports: { verifyJwt: async (token: string) => ({ jti: token, sub: 'owner' }) } });
mock.module('../auth/getCurrentUser', { namedExports: {
	getCurrentUser: async () => ({ id: 'owner', accountKind: 'user' }),
	resolveSessionUser: async () => ({ id: 'owner', accountKind: 'user' }),
	isFullAccountSessionPurpose: (purpose: unknown) => purpose == null || ['browser', 'service'].includes(String(purpose))
} });
mock.module('../auth/vaultKeys', { namedExports: { withUserVaultKey: async (_owner: string, work: any) => {
	const bytes = Buffer.alloc(32, 7); try { return await work({ id: 'vault-key-fixture', bytes }); } finally { bytes.fill(0); }
} } });
mock.module('../storage/accountedThings', { namedExports: {
	insertAccountedThing: (collection: any, doc: any, options: any) => collection.insertOne(doc, options),
	updateAccountedThing: (collection: any, filter: any, update: any, options: any) => collection.updateOne(filter, update, options)
} });
const { createBackupJobCoordinator } = await import('./backupJobs');
const { backupHashOperationId, initialBackupJobCursor, parseBackupJobCursor } = await import('./backupJobCore');
const { isProtectedThingtime, getThingtimeSchema, validateThingtimeCrystal } = await import('../../../schemas/registry');
const { CONTROL_PLANE_STORAGE_THINGTIMES } = await import('../storage/storageCore');
const { internalAccountSession } = await import('../auth/internalAccountSession');
const request = (session = 'original') => new Request('https://backup.test/api/v1/backups', { headers: { authorization: 'Bearer ' + session } });
const make = () => createBackupJobCoordinator({ now: () => clock, transaction, things: async () => things });
const input = () => ({ requestId: randomUUID(), operation: { kind: 'snapshot' as const, snapshotId: randomUUID(), destinationId: 'independent' }, destinationBinding: 'd'.repeat(64) });
async function admit() { const api = make(), value = input(), job = await api.admit(request(), value); return { api, job, value }; }
beforeEach(() => {
	rows = []; clock = Date.now(); customPlane = false; failAfterWrite = false; loseCommitReply = false; lock = Promise.resolve();
	sessionRows = [{ jti: 'original', userId: 'owner', revokedAt: null, expiresAt: new Date(clock + 3600000), purpose: 'browser' },
		{ jti: 'new-session', userId: 'owner', revokedAt: null, expiresAt: new Date(clock + 3600000), purpose: 'browser' }];
});
test('protected admission is idempotent and excludes credential/lease/hash state from projection', async () => {
	const { api, job, value } = await admit();
	assert.deepEqual(await api.admit(request(), value), job);
	assert.equal(rows.filter(row => row.thingtime.includes('backup-job')).length, 1);
	assert.equal(rows.filter(row => row.thingtime.includes('backup-job-event')).length, 1);
	assert.deepEqual(Object.keys(job).sort(), ['createdAt', 'id', 'issue', 'kind', 'progress', 'status', 'updatedAt']);
	assert.equal('backupSessionReference' in job, false);
	await assert.rejects(api.admit(request('new-session'), value));
	await assert.rejects(api.admit(request(), { ...value, destinationBinding: 'e'.repeat(64) }));
});
test('pause/cancel invalidate current lease; resume retains immutable original identities', async () => {
	const { api, job, value } = await admit(), claim = await api.claim(job.id);
	assert.ok(claim.lease);
	const duplicate = await api.claim(job.id); assert.equal(duplicate.lease, null); assert.ok(duplicate.delayMs > 0);
	await api.control(request(), job.id, 'pause');
	await assert.rejects(api.withLease(claim.lease!, ctx => ctx.guard()));
	await api.control(request(), job.id, 'resume');
	const resumed = await api.claim(job.id); assert.ok(resumed.lease!.generation > claim.lease!.generation);
	assert.equal(rows[0].backupOperation.snapshotId, value.operation.snapshotId);
	await api.control(request(), job.id, 'cancel');
	await assert.rejects(api.withLease(resumed.lease!, ctx => ctx.guard()));
	assert.equal((await api.claim(job.id)).lease, null);
});
test('original session expiry/revocation/purpose/owner/Character and home-plane changes refuse the commit fence', async () => {
	for (const mutate of [
		(s: any) => { s.revokedAt = new Date(); }, (s: any) => { s.expiresAt = new Date(0); },
		(s: any) => { s.purpose = 'device'; }, (s: any) => { s.userId = 'other'; },
		(s: any) => { s.meta = { activeCharacterId: 'character' }; }
	]) {
		const { api, job } = await admit(), { lease } = await api.claim(job.id);
		const originalSession = sessionRows[0];
		await api.withLease(lease!, async ctx => { mutate(originalSession); await assert.rejects(ctx.checkpoint({ ...ctx.cursor, itemsProcessed: 1 })); });
		sessionRows[0] = { jti: 'original', userId: 'owner', revokedAt: null, expiresAt: new Date(clock + 3600000), purpose: 'browser' };
		await api.control(request(), job.id, 'cancel');
	}
	const { api, job } = await admit(), { lease } = await api.claim(job.id);
	customPlane = true; await assert.rejects(api.withLease(lease!, ctx => ctx.guard()));
});
test('an owner can cancel a job after its original session is revoked, but cannot resume it', async () => {
	const { api, job } = await admit(); await api.control(request(), job.id, 'pause');
	sessionRows[0].revokedAt = new Date();
	await assert.rejects(api.control(request('new-session'), job.id, 'resume'));
	assert.equal((await api.control(request('new-session'), job.id, 'cancel')).status, 'cancelled');
});
test('new owner sessions see lost original authorization without reviving queued/running jobs', async () => {
	for (const running of [false, true]) {
		const { api, job } = await admit(); if (running) await api.claim(job.id);
		sessionRows[0].revokedAt = new Date();
		const observed = await api.current(request('new-session'), job.id);
		assert.equal(observed.status, 'needs-attention'); assert.equal(observed.issue, 'authorization-changed');
		assert.equal(rows.find(row => row.shareId === job.id).backupStatus, running ? 'running' : 'queued');
		await assert.rejects(api.claim(job.id));
		await api.control(request('new-session'), job.id, 'cancel');
		sessionRows[0].revokedAt = null;
	}
});
test('Workflow reservations and run receipts fence late old initialization across resume', async () => {
 const {api,job}=await admit(),reserved=await api.reserveDispatch(job.id,'https://backup.test');
 assert.equal(reserved.start,true);assert.ok(reserved.dispatchId);
 assert.equal((await api.reserveDispatch(job.id,'https://backup.test')).start,false);
 assert.equal(await api.attachWorkflow(job.id,reserved.dispatchId!,'run-old'),true);
 assert.equal(await api.attachWorkflow(job.id,reserved.dispatchId!,'run-old'),true);
 assert.equal(await api.attachWorkflow(job.id,reserved.dispatchId!,'run-duplicate'),false);
 assert.equal((await api.claim(job.id,'run-duplicate')).lease,null);
 assert.ok((await api.claim(job.id,'run-old')).lease);
 await api.control(request(),job.id,'pause');await api.control(request(),job.id,'resume');
 assert.equal(await api.attachWorkflow(job.id,reserved.dispatchId!,'late-old'),false);
 const next=await api.reserveDispatch(job.id,'https://backup.test');assert.equal(next.start,true);assert.notEqual(next.dispatchId,reserved.dispatchId);
 assert.equal(await api.attachWorkflow(job.id,next.dispatchId!,'run-new'),true);
 assert.equal((await api.claim(job.id,'run-old')).lease,null);assert.ok((await api.claim(job.id,'run-new')).lease);
});
test('uncertain dispatch never blindly restarts and expired unattached recovery invalidates its exact attempt',async()=>{
 const {api,job}=await admit();loseCommitReply=true;
 await assert.rejects(api.reserveDispatch(job.id,'https://backup.test'),/lost commit/);
 const prior=rows[0].backupDispatchId;assert.ok(prior);
 assert.equal((await api.reserveDispatch(job.id,'https://backup.test')).start,false);
 await api.markDispatchUnconfirmed(job.id,prior);assert.equal((await api.current(request(),job.id)).issue,'dispatch-unconfirmed');
 clock+=120001;const next=await api.reserveDispatch(job.id,'https://backup.test',true);
 assert.equal(next.start,true);assert.notEqual(next.dispatchId,prior);
 assert.equal(await api.attachWorkflow(job.id,prior,'late-uncertain-run'),false);
 assert.equal(await api.attachWorkflow(job.id,next.dispatchId!,'recovered-run'),true);
 assert.equal((await api.current(request(),job.id)).issue,null);
});
test('scheduler reservations preserve pause/cancel and refuse revoked original authorization',async()=>{
 for(const action of ['pause','cancel'] as const){const {api,job}=await admit();await api.control(request(),job.id,action);assert.equal((await api.reserveDispatch(job.id,'https://backup.test',true)).start,false);}
 const {api,job}=await admit();await assert.rejects(api.reserveDispatch(job.id,'https://other.test'));
 sessionRows[0].revokedAt=new Date();await assert.rejects(api.reserveDispatch(job.id,'https://backup.test',true));
});
test('bounded-window renewal preserves lease identity, recovers unknown commit and never revives stale authority', async () => {
	const { api, job } = await admit(), { lease } = await api.claim(job.id);
	await api.withLease(lease!, async ctx => {
		const firstExpiry = rows[0].backupLeaseExpiresAt.getTime();
		clock += 60_000; loseCommitReply = true; await assert.rejects(ctx.guard(), /lost commit/);
		assert.equal(rows[0].backupLeaseId, lease!.leaseId); assert.equal(rows[0].backupGeneration, lease!.generation);
		assert.ok(rows[0].backupLeaseExpiresAt.getTime() > firstExpiry);
		await ctx.guard();
		await api.control(request(), job.id, 'pause'); await assert.rejects(ctx.guard());
	});
	await api.control(request(), job.id, 'resume');
	const replacement = await api.claim(job.id); assert.ok(replacement.lease);
	await assert.rejects(api.withLease(lease!, ctx => ctx.guard()));
	await api.withLease(replacement.lease!, async ctx => {
		sessionRows[0].expiresAt = new Date(0); await assert.rejects(ctx.guard());
		sessionRows[0].expiresAt = new Date(clock + 3600000);
		clock += 100_000; await assert.rejects(ctx.guard());
	});
});
const reference = (jobId: string) => ({ algorithm: 'sha256' as const, implementation: 'hash-wasm:4.12.0:sha256' as const,
	bindingHash: 'a'.repeat(64), operationId: backupHashOperationId(jobId, 'part', 'item:0', 'part:0'), stepId: randomUUID(),
	sequence: 0, offset: '0', previousDigest: null, stateDigest: 'b'.repeat(64), complete: false, finalDigest: null });
test('hash reference and scalar engine cursor commit together, roll back together and recover a lost reply', async () => {
	const { api, job } = await admit(), { lease } = await api.claim(job.id), start = reference(job.id);
	await api.withLease(lease!, async ctx => {
		const initial = { ...ctx.cursor }, next = { ...initial, bytesProcessed: '12' };
		const coordinator = ctx.hashCoordinator('part', next);
		failAfterWrite = true; await assert.rejects(coordinator.accept(start.bindingHash, null, start), /injected/);
		assert.equal(rows[0].backupHashPart, null); assert.deepEqual(rows[0].backupCursor, initial);
		loseCommitReply = true; await assert.rejects(coordinator.accept(start.bindingHash, null, start), /lost commit/);
		assert.deepEqual(rows[0].backupHashPart, start); assert.deepEqual(rows[0].backupCursor, next);
		assert.equal(await coordinator.accept(start.bindingHash, null, start), 'already-accepted');
		assert.deepEqual(ctx.cursor, next);
	});
});
test('stale siblings, different previous references, expired leases and cancellation cannot advance hash/cursor', async () => {
	const { api, job } = await admit(), { lease } = await api.claim(job.id), start = reference(job.id);
	await api.withLease(lease!, async ctx => {
		const coordinator = ctx.hashCoordinator('part', ref => ({ ...ctx.cursor, bytesProcessed: ref.offset }));
		assert.equal(await coordinator.accept(start.bindingHash, null, start), 'accepted');
		const next = { ...start, sequence: 1, offset: '10', previousDigest: start.stateDigest, stateDigest: 'c'.repeat(64), stepId: randomUUID() };
		assert.equal(await coordinator.accept(start.bindingHash, { ...start, stepId: randomUUID() }, next), 'conflict');
		assert.equal(await coordinator.accept(start.bindingHash, start, next), 'accepted');
		assert.equal(await coordinator.accept(start.bindingHash, start, { ...next, stateDigest: 'e'.repeat(64) }), 'conflict');
		clock += 100000; await assert.rejects(coordinator.accept(start.bindingHash, next, { ...next, sequence: 2 }));
	});
	const resumed = await api.claim(job.id); assert.ok(resumed.lease);
	await api.control(request(), job.id, 'cancel');
	await assert.rejects(api.withLease(resumed.lease!, ctx => ctx.guard()));
});
test('hash slots reset only after a completed exact reference and remain bounded across streams', async () => {
	const { api, job } = await admit(), { lease } = await api.claim(job.id), start = reference(job.id);
	await api.withLease(lease!, async ctx => {
		const coordinator = ctx.hashCoordinator('part', ref => ({ ...ctx.cursor, bytesProcessed: ref.offset }));
		await coordinator.accept(start.bindingHash, null, start);
		await assert.rejects(ctx.checkpoint(ctx.cursor, { clearHashSlots: ['part'] }));
		const done = { ...start, sequence: 1, offset: '10', previousDigest: start.stateDigest, stateDigest: 'c'.repeat(64),
			stepId: randomUUID(), complete: true, finalDigest: 'f'.repeat(64) };
		assert.equal(await coordinator.accept(start.bindingHash, start, done), 'accepted');
		await ctx.checkpoint(ctx.cursor, { clearHashSlots: ['part'] });
		assert.equal(rows[0].backupHashPart, null);
		await ctx.checkpoint(ctx.cursor, { clearHashSlots: ['part'] });
		const second = { ...reference(job.id), operationId: backupHashOperationId(job.id, 'part', 'item:1', 'part:0') };
		assert.equal(await coordinator.accept(second.bindingHash, null, second), 'accepted');
	});
});
test('completion requires pinned plan/seal and complete hash slots; completed-source projection contains no authority', async () => {
	const source = await admit(), { lease } = await source.api.claim(source.job.id);
	await source.api.withLease(lease!, async ctx => {
		await ctx.checkpoint({ ...ctx.cursor, phase: 'complete' });
		await assert.rejects(source.api.finish(lease!, { kind: 'complete' }));
		await ctx.checkpoint({ ...ctx.cursor, planHash: '1'.repeat(64), sealHash: '2'.repeat(64) });
	});
	loseCommitReply = true; await assert.rejects(source.api.finish(lease!, { kind: 'complete' }), /lost commit/);
	await source.api.finish(lease!, { kind: 'complete' });
	assert.equal(rows.filter(row => row.crystal?.transition === 'completed').length, 1);
	const dependent = await admit(), dependentLease = await dependent.api.claim(dependent.job.id);
	await dependent.api.withLease(dependentLease.lease!, async ctx => {
		const projection = await ctx.completedSource(source.job.id, 'snapshot');
		assert.deepEqual(Object.keys(projection).sort(), ['cursor', 'destinationBinding', 'jobId', 'operation']);
		assert.equal(projection.cursor.sealHash, '2'.repeat(64));
		await assert.rejects(ctx.completedSource(source.job.id, 'review'));
		await assert.rejects(ctx.completedSource(dependent.job.id, 'snapshot'));
	});
});
test('request references are transient, exact-origin and attach the same transactional lease fence', async () => {
	const { api, job } = await admit(), { lease } = await api.claim(job.id);
	let child!: Request;
	await api.withLease(lease!, async ctx => {
		assert.equal(internalAccountSession(ctx.request)!.reference.jti, 'original');
		child = new Request('https://backup.test/api/v1/files');
		await ctx.withRequest(child, async () => { assert.equal(internalAccountSession(child)!.reference.jti, 'original'); });
		assert.equal(internalAccountSession(child), undefined);
		await assert.rejects(ctx.withRequest(new Request('https://other.test/api/v1/files'), async () => {}));
	});
	assert.equal(internalAccountSession(child), undefined);
});
test('checkpoint keys use stable vault derivation per exact job binding and refuse unknown IDs', async () => {
	const a = await admit(), b = await admit(), la = await a.api.claim(a.job.id), lb = await b.api.claim(b.job.id);
	let first!: Buffer;
	await a.api.withLease(la.lease!, async ctx => {
		const one = await ctx.hashKeys.current(), two = await ctx.hashKeys.current();
		first = one.key.export() as Buffer; assert.deepEqual(one.key.export(), two.key.export());
		assert.deepEqual((await ctx.hashKeys.get(one.id))!.export(), first);
		assert.equal(await ctx.hashKeys.get('retired-key'), null);
	});
	await b.api.withLease(lb.lease!, async ctx => { assert.notDeepEqual((await ctx.hashKeys.current()).key.export(), first); });
});
test('coordinator kinds are protected control records with no generic crystal sanitizer', () => {
	for (const kind of ['backup-job', 'backup-job-event']) {
		assert.equal(isProtectedThingtime([kind]), true); assert.ok(getThingtimeSchema(kind));
		assert.ok((CONTROL_PLANE_STORAGE_THINGTIMES as readonly string[]).includes(kind));
		const forged = validateThingtimeCrystal([kind], { status: 'completed', sessionId: 'synthetic-only' });
		assert.equal(forged.ok, false); if (!forged.ok) assert.equal(forged.status, 403);
		assert.equal(validateThingtimeCrystal([kind, 'data'], {}).ok, false);
	}
	assert.notEqual(backupHashOperationId(randomUUID(), 'part', 'item:0', 'part:0'), backupHashOperationId(randomUUID(), 'part', 'item:0', 'part:0'));
	const jobId = randomUUID(); assert.notEqual(backupHashOperationId(jobId, 'part', 'item:0', 'part:0'), backupHashOperationId(jobId, 'part', 'item:1', 'part:0'));
	assert.deepEqual(initialBackupJobCursor('snapshot').phase, 'inventory');
	assert.equal(initialBackupJobCursor('snapshot').stage, 'start');
	assert.throws(() => parseBackupJobCursor({ ...initialBackupJobCursor('snapshot'), stage: 'unknown' as any }));
	assert.throws(() => parseBackupJobCursor({ ...initialBackupJobCursor('snapshot'), history: [] } as any));
});

test('expired snapshots require a new operation while transient unavailability retries the exact original timestamp', async () => {
 for(const issue of ['snapshot-expired','snapshot-unavailable'] as const){
  const {api,job,value}=await admit(),{lease}=await api.claim(job.id);
  await api.withLease(lease!,ctx=>ctx.checkpoint({...ctx.cursor,snapshotSeconds:123,snapshotIncrement:7}));
  await api.finish(lease!,{kind:'pause',issue});
  assert.equal((await api.current(request(),job.id)).issue,issue);
  if(issue==='snapshot-expired')await assert.rejects(api.control(request(),job.id,'retry'));
  else {await api.control(request(),job.id,'retry');const resumed=await api.claim(job.id);await api.withLease(resumed.lease!,async ctx=>{
   assert.equal(ctx.cursor.snapshotSeconds,123);assert.equal(ctx.cursor.snapshotIncrement,7);assert.deepEqual(ctx.operation,value.operation);
  });}
 }
});

test('fresh guard reads do not write or renew a healthy lease and never cache revocation or purpose',async()=>{
 const {api,job}=await admit(),{lease}=await api.claim(job.id);
 await api.withLease(lease!,async ctx=>{
  const revision=rows[0].backupRevision,expiry=rows[0].backupLeaseExpiresAt.getTime(),sessionFence=sessionRows[0].accountMutationFence;
  for(let i=0;i<20;i++)await ctx.guard();
  assert.equal(rows[0].backupRevision,revision);assert.equal(rows[0].backupLeaseExpiresAt.getTime(),expiry);assert.equal(sessionRows[0].accountMutationFence,sessionFence);
  sessionRows[0].purpose='device';await assert.rejects(ctx.guard());sessionRows[0].purpose='browser';await ctx.guard();
  sessionRows[0].revokedAt=new Date();await assert.rejects(ctx.guard());sessionRows[0].revokedAt=null;
  rows[0].backupLeaseExpiresAt=new Date('invalid');await assert.rejects(ctx.guard());
 });
});

test('automatic dispatch backoff is finite and explicit owner retry starts a new fenced recovery budget',async()=>{
 const {api,job}=await admit();let last='';
 for(let attempt=0;attempt<5;attempt++){
  const reserved=await api.reserveDispatch(job.id,'https://backup.test',true);assert.equal(reserved.start,true);last=reserved.dispatchId!;
  await api.markDispatchUnconfirmed(job.id,last);
  assert.equal((await api.reserveDispatch(job.id,'https://backup.test',true)).start,false);
  clock=rows[0].backupDispatchNextAt.getTime()+1;
 }
 assert.equal((await api.reserveDispatch(job.id,'https://backup.test',true)).start,false);
 await api.control(request(),job.id,'retry');const next=await api.reserveDispatch(job.id,'https://backup.test');assert.equal(next.start,true);assert.notEqual(next.dispatchId,last);
 assert.equal(await api.attachWorkflow(job.id,last,'late-exhausted-run'),false);
});
test('transient dispatch deferral changes only scheduling and preserves original authority',async()=>{
 const {api,job}=await admit();const before=clone(rows[0]);assert.equal(await api.deferDispatch(job.id,'https://backup.test'),true);
 assert.ok(rows[0].backupDispatchNextAt.getTime()>clock);assert.equal(rows[0].backupGeneration,before.backupGeneration);assert.equal(rows[0].backupStatus,'queued');assert.equal(rows[0].backupDispatchAttempts,0);assert.deepEqual(rows[0].backupSessionReference,before.backupSessionReference);
 sessionRows.find(row=>row.jti==='original').revokedAt=new Date(clock);assert.equal(await api.retireInvalidAuthorization(job.id,'https://backup.test'),true);assert.equal(rows[0].backupStatus,'needs-attention');assert.equal(rows[0].backupIssue,'authorization-changed');assert.equal(await api.deferDispatch(job.id,'https://backup.test'),false);await assert.rejects(api.claim(job.id));
});

test('SDK acknowledgement alone never confirms execution; exact first-step deployment confirmation is private',async()=>{
 const {api,job}=await admit(),origin='https://backup.test',deployment='deployment-current';
 assert.equal(await api.executionConfirmation(origin,deployment),null);
 const dispatch=await api.reserveDispatch(job.id,origin);assert.equal(await api.attachWorkflow(job.id,dispatch.dispatchId!,'sdk-run'),true);
 assert.equal(await api.executionConfirmation(origin,deployment),null);
 assert.equal(await api.confirmWorkflowExecution(job.id,randomUUID(),'sdk-run',deployment),false);
 assert.equal(await api.confirmWorkflowExecution(job.id,dispatch.dispatchId!,'sdk-run',deployment),true);
 assert.equal(await api.executionConfirmation(origin,deployment),new Date(clock).toISOString());assert.equal(await api.executionConfirmation(origin,'new-deployment'),null);
 const projection=JSON.stringify(await api.current(request(),job.id));assert.ok(!projection.includes('sdk-run'));assert.ok(!projection.includes(deployment));
});
test('visible status uses its exact supplied observation time for original-session expiry',async()=>{
 const {api,job}=await admit();clock=sessionRows[0].expiresAt.getTime()+1;const view=await api.current(request('new-session'),job.id);assert.equal(view.status,'needs-attention');assert.equal(view.issue,'authorization-changed');
});
