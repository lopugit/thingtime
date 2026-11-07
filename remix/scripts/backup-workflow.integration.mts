/** Disposable replica proof. Production signup/auth/Things/Files Request
 * handlers and canonical coordinator/transaction utilities only: no direct
 * Mongo collection reads, writes, test identities or credentials in receipts. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BackupEngineContext } from '../app/api/utils/backups/backupJobs';
import type { BackupJobLease } from '../app/api/utils/backups/backupJobCore';
import type { HashCheckpointRef } from '../app/api/utils/backups/resumableHash';

const directory = process.env.THINGTIME_ACCOUNT_PROFILE_TEST_DIRECTORY;
assert.ok(
	directory && /^mongodb:\/\/127\.0\.0\.1:28172\/thingtime\?replicaSet=account-profile-backup$/.test(process.env.MONGODB_CONNECTION_STRING || ''),
	'Use the disposable backup-workflow runner'
);
const base = 'http://127.0.0.1:28172';
assert.equal(new URL(base).port, '28172');
process.env.APP_URL = base;
process.env.JWT_SECRET ||= randomBytes(48).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY ||= randomBytes(32).toString('base64url');
process.env.ADMIN_USERNAMES = '';
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR = join(directory!, 'objects');
process.env.THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN = base;

const register = await import('../app/routes/api/v1/auth/register/_register');
const login = await import('../app/routes/api/v1/login/_login');
const logout = await import('../app/routes/api/v1/auth/logout/_logout');
const thingsRoute = await import('../app/routes/api/v1/things/_things');
const bulkRoute = await import('../app/routes/api/v1/things/bulk/_bulk');
const exportRoute = await import('../app/routes/api/v1/things/export/_export');
const filesRoute = await import('../app/routes/api/v1/files/_files');
const me = await import('../app/routes/api/v1/auth/me/_me');
const { getCurrentUser } = await import('../app/api/utils/auth/getCurrentUser');
const { fenceAccountSession } = await import('../app/api/utils/auth/fenceAccountSession');
const { createThing, canView, canViewInherited, findViewableThing } = await import('../app/api/utils/things/things');
const { withHomeMongoTransaction } = await import('../app/api/utils/mongodb/collections');
const { createBackupJobCoordinator } = await import('../app/api/utils/backups/backupJobs');
const { backupHashOperationId } = await import('../app/api/utils/backups/backupJobCore');
const { createResumableHashWorker } = await import('../app/api/utils/backups/resumableHash');
const { openLocalBackupStore } = await import('../app/api/utils/backups/localBackupStore');

const request = (cookie: string, path = '/api/v1/things', body?: unknown, method?: string) =>
	new Request(base + path, {
		method: method ?? (body === undefined ? 'GET' : 'POST'),
		headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
const cookies = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
async function call(handler: any, cookie: string, path: string, body?: unknown, method?: string) {
	const response: Response = await handler({ request: request(cookie, path, body, method) });
	return { response, data: await response.json() };
}
async function signup() {
	const username = 'backup-workflow-' + randomUUID().slice(0, 8),
		password = randomUUID() + '-Disposable!';
	const { response, data } = await call(register.action, '', '/api/v1/auth/register', { username, email: username + '@example.invalid', password });
	assert.equal(response.status, 200);
	assert.equal(data.ok, true);
	const cookie = cookies(response),
		user = await getCurrentUser(request(cookie));
	assert.ok(user);
	assert.equal(user!.id, data.user.id);
	return { username, password, cookie, user: user! };
}
async function signBackIn(account: Awaited<ReturnType<typeof signup>>) {
	const { response, data } = await call(login.action, '', '/api/v1/login', { username: account.username, password: account.password });
	assert.equal(response.status, 200);
	assert.equal(data.ok, true);
	account.cookie = cookies(response);
	assert.equal((await getCurrentUser(request(account.cookie)))?.id, account.user.id);
}
let clockOffset = 0;
const jobs = createBackupJobCoordinator({ now: () => Date.now() + clockOffset });
const binding = 'd'.repeat(64);
async function admitted(account: Awaited<ReturnType<typeof signup>>) {
	const snapshotId = randomUUID();
	const job = await jobs.admit(request(account.cookie, '/api/v1/backups'), {
		requestId: randomUUID(),
		operation: { kind: 'snapshot', snapshotId, destinationId: 'isolated-private-vault' },
		destinationBinding: binding
	});
	return { job, snapshotId };
}
const sourceBytes = () => new Uint8Array(Buffer.alloc(2 * 1024 * 1024 + 257, 0x6d));
async function hashWorker(context: BackupEngineContext, snapshotId: string, loseReply = false) {
	const store = await openLocalBackupStore(join(directory!, 'hash-vault'));
	const bytes = sourceBytes(),
		digest = createHash('sha256').update(bytes).digest('hex');
	const stream = {
		operationId: backupHashOperationId(context.jobId, 'part', 'file:0', 'part:0'),
		snapshotId,
		streamId: 'fixture-file:0:part:0',
		objectVersion: digest,
		bytes: String(bytes.length),
		expectedSha256: digest
	};
	const source = {
		assertIdentity: async () => {
			assert.equal(createHash('sha256').update(bytes).digest('hex'), digest);
			await context.guard();
		},
		read: async (offset: bigint, length: number) => bytes.slice(Number(offset), Number(offset) + length)
	};
	const coordinator = context.hashCoordinator('part', (ref) => ({ ...context.cursor, bytesProcessed: ref.offset, rangeOffset: ref.offset }));
	let lost = false;
	const worker = createResumableHashWorker({
		store,
		keys: context.hashKeys,
		access: { scope: { apiOrigin: base, ownerId: (await getCurrentUser(context.request))!.id, dataPlane: 'home' }, authorize: context.guard },
		coordinator: {
			current: coordinator.current,
			accept: async (...args) => {
				const result = await coordinator.accept(...args);
				if (loseReply && !lost && args[2].sequence > 0) {
					lost = true;
					throw Error('Synthetic accepted-checkpoint reply lost');
				}
				return result;
			}
		}
	});
	return { worker, stream, source, bytes, digest };
}

async function inventoryProof() {
	const { createAccountInventoryStepper, initialAccountInventoryCursor, ACCOUNT_INVENTORY_STEP_RECORDS } = await import(
		'../app/api/utils/backups/accountInventorySteps'
	);
	const { captureBackup, sealBackup } = await import('../app/api/utils/backups/portableBackup');
	const { openBackupThingSnapshot } = await import('../app/api/utils/backups/thingSnapshots');
	const { BACKUP_PAGE_BYTES } = await import('../app/backups/manifest');
	const account = await signup(),
		seeded: { id: string; text: string }[] = [],
		sourceItems = 1000;
	// The disposable fixture uses its documented administration handler to admit
	// this measured synthetic profile. Production limits and state are untouched.
	const rateLimits = await import('../app/routes/api/v1/admin/rate-limits/_rate-limits');
	process.env.ADMIN_USERNAMES = account.username;
	const configured = await call(rateLimits.action, account.cookie, '/api/v1/admin/rate-limits', {
		endpoints: { 'things.write': { limit: 2000, windowMs: 60000, enabled: true } }
	});
	assert.equal(configured.response.status, 200);
	assert.equal(configured.data.config['things.write'].limit, 2000);
	process.env.ADMIN_USERNAMES = '';
	// Establish the documented consolidated index generation, including the
	// bounded owner/identity scan. Never fall back to an unindexed full scan.
	process.env.ADMIN_USERNAMES = account.username;
	const migrations = await import('../app/routes/api/v1/admin/migrations/run/_run');
	const migrate = async () => {
		const result = await call(migrations.action, account.cookie, '/api/v1/admin/migrations/run', {
			migration: 'retire-legacy-thing-indexes',
			confirm: true
		});
		assert.equal(result.response.status, 200);
		assert.equal(result.data.ok, true);
	};
	await migrate();
	await new Promise((resolve) => setTimeout(resolve, 60_100));
	await migrate();
	const { ensureIndexes } = await import('../app/api/utils/mongodb/collections');
	await ensureIndexes({ force: true });
	process.env.ADMIN_USERNAMES = '';
	const seedStart = performance.now();
	for (let index = 0; index < sourceItems; index++) {
		const text = `Independent synthetic source ${index}: ` + 'stable-content '.repeat(64);
		const created = await call(thingsRoute.action, account.cookie, '/api/v1/things', {
			shareId: 'inventory-source-' + String(index).padStart(5, '0'),
			thingtime: ['data'],
			acl: ['tt:user'],
			crystal: { text }
		});
		assert.equal(created.response.status, 200);
		assert.equal(created.data.ok, true);
		const id = created.data.thing.id;
		assert.ok(id);
		seeded.push({ id, text });
	}
	const seedElapsedMs = performance.now() - seedStart;
	for (const index of [0, 500, 999]) {
		const observed = await call(thingsRoute.loader, account.cookie, '/api/v1/things?id=' + seeded[index].id);
		assert.equal(observed.response.status, 200);
		assert.equal(observed.data.thing.crystal.text, seeded[index].text);
	}
	const admittedInventory = await admitted(account),
		store = await openLocalBackupStore(join(directory!, 'inventory-vault'));
	let cursor = initialAccountInventoryCursor(),
		complete = false,
		plan: any = null,
		steps = 0,
		censusSteps = 0,
		referenceSteps = 0,
		maxStepMs = 0,
		censusElapsedMs = 0;
	const counters = { authorizations: 0, receiptReplays: 0 };
	const inventoryStart = performance.now();
	let censusCompletedMs: number | null = null;
	let afterBoundary = false,
		laterId: string | null = null;
	while (!complete) {
		assert.ok(performance.now() - inventoryStart < 540_000, 'Bounded synthetic inventory exceeded its deadline');
		const claimed = await jobs.claim(admittedInventory.job.id);
		assert.ok(claimed.lease);
		const stepStart = performance.now(),
			expectedCursor = { ...cursor };
		const result = await jobs.withLease(claimed.lease!, async (context) => {
			const previous = context.cursor;
			const input = {
				seconds: previous.snapshotSeconds,
				increment: previous.snapshotIncrement,
				lastThingId: previous.inventoryLastId,
				nextOrdinal: previous.fileIndex,
				pages: previous.planPage ?? 0,
				previousHash: previous.headHash,
				bytes: previous.inventoryBytes,
				excluded: previous.inventoryExcluded,
				referenceStateHash: previous.inventoryReferenceStateHash
			};
			assert.deepEqual(input, expectedCursor);
			const access = {
				scope: { ownerId: account.user.id, apiOrigin: base, dataPlane: 'home' },
				authorize: async () => {
					counters.authorizations++;
					await context.guard();
				}
			};
			const advanced = await createAccountInventoryStepper()(store, admittedInventory.snapshotId, access, input);
			if (advanced.cursor.pages > input.pages && counters.receiptReplays === 0) {
				// Discard the acknowledgement, then reconstruct a fresh producer with the
				// original durable input. No cursor acceptance happened in between.
				const recovered = await createAccountInventoryStepper()(store, admittedInventory.snapshotId, access, JSON.parse(JSON.stringify(input)));
				assert.deepEqual(recovered, advanced);
				counters.receiptReplays++;
			}
			await context.checkpoint({
				...previous,
				snapshotSeconds: advanced.cursor.seconds,
				snapshotIncrement: advanced.cursor.increment,
				inventoryLastId: advanced.cursor.lastThingId,
				fileIndex: advanced.cursor.nextOrdinal,
				planPage: advanced.cursor.pages,
				headHash: advanced.cursor.previousHash,
				inventoryBytes: advanced.cursor.bytes,
				inventoryExcluded: advanced.cursor.excluded,
				inventoryReferenceStateHash: advanced.cursor.referenceStateHash
			});
			return advanced;
		});
		await jobs.finish(claimed.lease!, { kind: 'continue' });
		steps++;
		maxStepMs = Math.max(maxStepMs, performance.now() - stepStart);
		if (result.cursor.lastThingId !== cursor.lastThingId || cursor.seconds === null) {
			censusSteps++;
			censusElapsedMs = performance.now() - inventoryStart;
		} else {
			referenceSteps++;
			censusCompletedMs ??= performance.now() - inventoryStart;
		}
		cursor = result.cursor;
		complete = result.complete;
		plan = result.plan;
		if (!afterBoundary) {
			afterBoundary = true;
			assert.ok(cursor.seconds !== null && cursor.increment !== null);
			assert.equal(cursor.pages, 0);
			assert.equal(
				await store.read(`snapshots/${admittedInventory.snapshotId}/header.json`, 131072),
				null,
				'Timestamp acceptance must precede any immutable header or content'
			);
			assert.equal(
				(
					await call(
						thingsRoute.action,
						account.cookie,
						'/api/v1/things',
						{ id: seeded[0].id, crystal: { text: 'Changed after pinned timestamp' } },
						'PATCH'
					)
				).response.status,
				200
			);
			assert.equal((await call(thingsRoute.action, account.cookie, '/api/v1/things', { id: seeded[500].id }, 'DELETE')).response.status, 200);
			const inserted = await call(thingsRoute.action, account.cookie, '/api/v1/things', {
				shareId: 'inventory-later-insert',
				thingtime: ['data'],
				acl: ['tt:user'],
				crystal: { text: 'Must not enter the earlier point-in-time' }
			});
			assert.equal(inserted.response.status, 200);
			laterId = inserted.data.thing.id;
			assert.ok(laterId);
			assert.equal(
				(await call(thingsRoute.loader, account.cookie, '/api/v1/things?id=' + seeded[0].id)).data.thing.crystal.text,
				'Changed after pinned timestamp'
			);
			assert.equal((await call(thingsRoute.loader, account.cookie, '/api/v1/things?id=' + seeded[500].id)).response.status, 404);
		}
	}
	const planElapsedMs = performance.now() - inventoryStart;
	censusElapsedMs = censusCompletedMs ?? censusElapsedMs;
	assert.ok(plan && counters.receiptReplays === 1);
	assert.ok(censusElapsedMs < 300_000, 'This fixture census must fit its configured 300-second snapshot history window');
	const items: any[] = [];
	for (let page = 0; page < plan.pages; page++) {
		const bytes = await store.read(`snapshots/${admittedInventory.snapshotId}/plan/${page}.json`, BACKUP_PAGE_BYTES);
		assert.ok(bytes);
		items.push(...JSON.parse(Buffer.from(bytes!).toString()).items);
	}
	assert.equal(items.filter((item) => seeded.some((source) => source.id === item.thingId)).length, sourceItems);
	assert.ok(laterId && !items.some((item) => item.thingId === laterId));
	for (const index of [0, 500, 999])
		assert.equal(items.find((item) => item.thingId === seeded[index].id).snapshot.value.crystal.text, seeded[index].text);
	const coverage = items.filter((item) => item.snapshot.adapter === 'backup-reference-coverage');
	assert.ok(coverage.length);
	assert.ok(
		coverage.every(
			(item) =>
				item.snapshot.value.coverage.discovery === 'complete' &&
				item.snapshot.value.coverage.resolution === 'closed' &&
				item.snapshot.value.coverage.wholeAccountReady === false
		)
	);
	const access = {
		scope: { ownerId: account.user.id, apiOrigin: base, dataPlane: 'home' },
		authorize: async () => {
			assert.equal((await getCurrentUser(request(account.cookie)))?.id, account.user.id);
		}
	};
	await captureBackup(
		store,
		admittedInventory.snapshotId,
		{
			read: async () => {
				throw Error('Retained inventory content must not consult live bytes');
			}
		},
		access
	);
	const seal = await sealBackup(store, admittedInventory.snapshotId, access);
	assert.equal(seal.items, plan.items);
	for (const index of [0, 500, 999])
		assert.equal(
			((await openBackupThingSnapshot(store, admittedInventory.snapshotId, seeded[index].id, access)).value as any).crystal.text,
			seeded[index].text
		);
	await jobs.control(request(account.cookie), admittedInventory.job.id, 'cancel');
	return {
		sourceItems,
		sourceTextBytes: seeded.reduce((bytes, row) => bytes + Buffer.byteLength(row.text), 0),
		seedElapsedMs: Math.round(seedElapsedMs),
		inventorySteps: steps,
		censusSteps,
		referenceSteps,
		processingBatchRecords: ACCOUNT_INVENTORY_STEP_RECORDS,
		planItems: plan.items,
		planPages: plan.pages,
		inventoryElapsedMs: Math.round(performance.now() - inventoryStart),
		censusElapsedMs: Math.round(censusElapsedMs),
		maxStepMs: Math.round(maxStepMs),
		coordinatorAuthorizationCalls: counters.authorizations,
		referenceElapsedMs: Math.round(planElapsedMs - censusElapsedMs),
		planElapsedMs: Math.round(planElapsedMs),
		retainedPayloadBytes: plan.bytes,
		workflowSchedulingProjection: {
			actualHostedDispatchLatencyMs: null,
			formula: 'measured census milliseconds + census units times additional hosted dispatch milliseconds',
			censusUnits: censusSteps + 1,
			additionalDispatchBudgetMsPerCensusUnit: Math.floor((300000 - censusElapsedMs) / (censusSteps + 1))
		},
		configuredFixtureSnapshotHistorySeconds: 300,
		receiptReplays: counters.receiptReplays,
		verification:
			'real API source reads and mutations, public pinned snapshot find, fresh stepper per protected lease, immutable receipt recovery, canonical reference evidence and v1 seal/readback'
	};
}

if (process.argv[2] === '--checkpoint-child') {
	process.once('message', async (input: { lease: BackupJobLease; snapshotId: string }) => {
		try {
			await jobs.withLease(input.lease, async (context) => {
				const { worker, stream, source } = await hashWorker(context, input.snapshotId);
				const first = await worker.start(stream, source),
					stepId = randomUUID();
				const accepted = await worker.advance(stream, first, stepId, source, 2 * 1024 * 1024);
				process.send?.({ checkpoint: accepted, stepId, bytesProcessed: context.cursor.bytesProcessed });
				// Remain alive at the observed durable checkpoint until the parent
				// kills this task-owned child. No foreground timer or polling loop.
				await new Promise<void>(() => {});
			});
		} catch {
			process.exit(76);
		}
	});
} else {
	assert.equal(process.argv.length, 2);
	const owner = await signup(),
		foreign = await signup();
	const source = await admitted(owner),
		{ lease } = await jobs.claim(source.job.id);
	assert.ok(lease);
	const folderResponse = await call(thingsRoute.action, owner.cookie, '/api/v1/things', {
		thingtime: ['folder'],
		acl: ['tt:user'],
		crystal: { name: 'Coordinator fixture folder' }
	});
	assert.equal(folderResponse.response.status, 200);
	const folderId = folderResponse.data.thing.id ?? folderResponse.data.thing.shareId;
	assert.ok(folderId);
	const ordinary = await call(thingsRoute.action, owner.cookie, '/api/v1/things', {
		thingtime: ['data'],
		acl: ['tt:all'],
		crystal: { text: 'Ordinary fixture content' }
	});
	assert.equal(ordinary.response.status, 200);
	const ordinaryId = ordinary.data.thing.id;
	assert.equal((await call(thingsRoute.loader, '', '/api/v1/things?id=' + ordinaryId)).response.status, 200);
	assert.equal(
		(await call(thingsRoute.action, owner.cookie, '/api/v1/things', { id: ordinaryId, crystal: { text: 'Ordinary edit remains allowed' } }, 'PATCH'))
			.response.status,
		200
	);
	assert.equal((await call(thingsRoute.action, owner.cookie, '/api/v1/things', { id: ordinaryId }, 'DELETE')).response.status, 200);
	for (const kind of ['backup-job', 'backup-job-event']) {
		const forged = await call(thingsRoute.action, owner.cookie, '/api/v1/things', { thingtime: [kind], crystal: { status: 'completed' } });
		assert.equal(forged.response.status, 403);
	}
	for (const cookie of [owner.cookie, foreign.cookie, '']) {
		const hidden = await call(thingsRoute.loader, cookie, '/api/v1/things?id=' + source.job.id);
		assert.equal(hidden.response.status, 404);
	}
	for (const account of [owner, foreign]) {
		const hidden = await call(
			thingsRoute.loader,
			account.cookie,
			'/api/v1/things?ids=' + encodeURIComponent(JSON.stringify([source.job.id, folderId]))
		);
		assert.equal(hidden.response.status, 200);
		assert.equal(hidden.data.things[0], null);
		assert.equal(hidden.data.things[1]?.id ?? null, account === owner ? folderId : null);
	}
	assert.equal(await findViewableThing(source.job.id, owner.user), null);
	const exported = await call(exportRoute.action, owner.cookie, '/api/v1/things/export', { ids: [source.job.id] });
	assert.equal(exported.data.ok, false);
	assert.ok(exported.response.status >= 400);
	for (const kind of ['backup-job', 'backup-job-event'])
		for (const kinds of [[kind], [kind, 'data']]) {
			// Pure visibility helpers must also refuse malformed mixed-schema
			// control records without creating such a row through a bypass.
			const mixed: any = { shareId: source.job.id, ownerId: owner.user.id, thingtime: kinds, acl: ['tt:all'] };
			assert.equal(canView(mixed, owner.user), false);
			assert.equal(await canViewInherited(mixed, owner.user), false);
			const control = { ...mixed, acl: ['tt:inherit'], targetId: 'fixture-public-ancestor' };
			const inherited: any = {
				shareId: 'fixture-inherited-child',
				ownerId: owner.user.id,
				thingtime: ['data'],
				acl: ['tt:inherit'],
				targetId: control.shareId
			};
			const publicAncestor: any = { shareId: 'fixture-public-ancestor', ownerId: owner.user.id, thingtime: ['data'], acl: ['tt:all'] };
			assert.equal(await canViewInherited(inherited, owner.user, async (id) => (id === control.shareId ? control : publicAncestor)), false);
			assert.equal(await canViewInherited({ ...inherited, targetId: publicAncestor.shareId }, null, async () => publicAncestor), true);
		}
	for (const method of ['PATCH', 'PUT', 'DELETE']) {
		const result = await call(
			thingsRoute.action,
			owner.cookie,
			'/api/v1/things',
			{ id: source.job.id, shareId: source.job.id, thingtime: ['backup-job'], crystal: { status: 'completed' } },
			method
		);
		assert.ok([403, 404].includes(result.response.status), 'Protected generic mutation must refuse');
	}
	for (const op of ['move', 'copy', 'delete', 'share']) {
		const result = await call(bulkRoute.action, owner.cookie, '/api/v1/things/bulk', {
			op,
			ids: [source.job.id],
			...(['move', 'copy'].includes(op) ? { folderId } : {}),
			...(op === 'share' ? { acl: ['tt:all'] } : {})
		});
		assert.equal(result.data.succeeded, 0);
		assert.equal(result.data.failed, 1);
	}
	await jobs.withLease(lease!, async (context) => {
		const child = new Request(base + '/api/v1/files?folderId=' + folderId);
		const files = await context.withRequest(child, () => filesRoute.loader({ request: child }));
		assert.equal(files.status, 200);
		const who = new Request(base + '/api/v1/auth/me');
		const session = await context.withRequest(who, () => me.loader({ request: who } as any));
		assert.equal(session.status, 200);
		assert.equal((await session.json()).user.id, owner.user.id);
	});

	// Establish a genuine content-writing snapshot BEFORE the concurrent
	// authority change, then fence at commit. Mongo retries the write conflict;
	// the retried callback must refuse and roll back content plus its ledger.
	async function commitRace(kind: 'pause' | 'revoke') {
		const account = await signup(),
			{ job } = await admitted(account),
			claimed = await jobs.claim(job.id);
		assert.ok(claimed.lease);
		const contentId = randomUUID();
		let raced = false,
			attempts = 0;
		await jobs.withLease(claimed.lease!, async (context) => {
			await assert.rejects(
				withHomeMongoTransaction(async (session) => {
					attempts++;
					const created = await createThing(
						account.user.id,
						{ shareId: contentId, thingtime: ['data'], acl: ['tt:user'], crystal: { text: 'Must roll back with authority' } },
						account.user,
						null,
						{ transaction: { session, afterCommit: () => {} } }
					);
					assert.equal(created.ok, true);
					if (!raced) {
						raced = true;
						if (kind === 'pause') await jobs.control(request(account.cookie), job.id, 'pause');
						else assert.equal((await call(logout.action, account.cookie, '/api/v1/auth/logout', {})).response.status, 200);
					}
					await fenceAccountSession(context.request, account.user.id, session);
				})
			);
		});
		assert.ok(raced);
		assert.ok(attempts >= (kind === 'pause' ? 2 : 1), 'The stale snapshot must retry before the current lease/session refusal');
		if (kind === 'revoke') {
			assert.equal(await getCurrentUser(request(account.cookie)), null);
			await signBackIn(account);
			const stopped = await jobs.current(request(account.cookie), job.id);
			assert.equal(stopped.status, 'needs-attention');
			assert.equal(stopped.issue, 'authorization-changed');
			await assert.rejects(jobs.claim(job.id));
		}
		const absent = await call(thingsRoute.loader, account.cookie, '/api/v1/things?id=' + contentId);
		assert.equal(absent.response.status, 404);
		await jobs.control(request(account.cookie), job.id, 'cancel');
		return attempts;
	}
	const pauseAttempts = await commitRace('pause'),
		revokeAttempts = await commitRace('revoke');

	// Actual AES-GCM objects + real Mongo checkpoint/cursor acceptance. Only
	// the return value is discarded after its transaction has really committed.
	await jobs.withLease(lease!, async (context) => {
		const { worker, stream, source: bytesSource } = await hashWorker(context, source.snapshotId, true);
		const first = await worker.start(stream, bytesSource),
			stepId = randomUUID();
		await assert.rejects(worker.advance(stream, first, stepId, bytesSource, 2 * 1024 * 1024), /reply lost/);
		const view = await jobs.current(request(owner.cookie), source.job.id);
		assert.equal(view.progress.bytes, String(2 * 1024 * 1024));
		const recovered = await worker.advance(stream, first, stepId, bytesSource, 2 * 1024 * 1024);
		assert.equal(recovered.offset, view.progress.bytes);
		assert.equal(context.cursor.bytesProcessed, recovered.offset);
		const done = await worker.advance(stream, recovered, randomUUID(), bytesSource);
		assert.equal(done.complete, true);
	});
	await jobs.control(request(owner.cookie), source.job.id, 'cancel');

	// Task-owned process death after an observed committed checkpoint. The
	// coordinator clock controls lease expiry only; auth still uses real time.
	const crash = await admitted(owner),
		crashClaim = await jobs.claim(crash.job.id);
	assert.ok(crashClaim.lease);
	const child = fork(fileURLToPath(import.meta.url), ['--checkpoint-child'], {
		execArgv: ['--import', 'tsx'],
		stdio: ['ignore', 'ignore', 'ignore', 'ipc']
	});
	const childExit = once(child, 'exit');
	const message = new Promise<{ checkpoint: HashCheckpointRef; stepId: string; bytesProcessed: string }>((resolve, reject) => {
		child.once('message', (value: any) => resolve(value));
		child.once('error', reject);
		child.once('exit', () => reject(Error('Checkpoint child exited before its accepted checkpoint')));
	});
	const deadline = setTimeout(() => child.kill('SIGTERM'), 45_000);
	let saved: Awaited<typeof message>;
	try {
		child.send({ lease: crashClaim.lease, snapshotId: crash.snapshotId });
		saved = await message;
	} finally {
		clearTimeout(deadline);
		child.kill('SIGKILL');
		await childExit;
	}
	assert.equal(saved!.bytesProcessed, String(2 * 1024 * 1024));
	clockOffset = 100_000;
	const resumed = await jobs.claim(crash.job.id);
	assert.ok(resumed.lease);
	assert.notEqual(resumed.lease!.leaseId, crashClaim.lease!.leaseId);
	await assert.rejects(jobs.withLease(crashClaim.lease!, (context) => context.guard()));
	await jobs.withLease(resumed.lease!, async (context) => {
		assert.equal(context.cursor.bytesProcessed, saved!.bytesProcessed);
		const { worker, stream, source: bytesSource, digest } = await hashWorker(context, crash.snapshotId);
		const restored = await worker.start(stream, bytesSource);
		assert.deepEqual(restored, saved!.checkpoint);
		const done = await worker.advance(stream, restored, randomUUID(), bytesSource);
		assert.equal(done.finalDigest, digest);
	});
	await jobs.control(request(owner.cookie), crash.job.id, 'cancel');
	const inventory = await inventoryProof();
	console.log(
		JSON.stringify({
			backupWorkflowProof: true,
			inventory,
			checks: [
				'real-signup-full-account-session',
				'generic-protected-create-read-update-delete-refused',
				'bulk-move-copy-delete-share-refused',
				'internal-original-session-auth-and-files-handlers',
				'pause-at-canonical-content-commit-rolls-back',
				'revocation-at-canonical-content-commit-rolls-back',
				'encrypted-hash-and-cursor-accepted-reply-loss-recovery',
				'child-process-kill-resumes-accepted-checkpoint',
				'expired-worker-cannot-reclaim',
				'exact-export-refused',
				'mixed-kind-and-inherited-control-refused',
				'ordinary-crud-preserved',
				'new-session-sees-original-authorization-loss'
			],
			transactionAttempts: { pause: pauseAttempts, revocation: revokeAttempts },
			boundary:
				'Production Request handlers/API-utils and disposable replica/private object store; logical lease-clock expiry, not HTTP/browser/deployed Workflow/S3 acceptance'
		})
	);
	process.exit(0);
}
