import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

// namespace.ts uses the app's `~` alias, so load it through Vite's SSR module
// runner while keeping these tests database-free and focused on the exact
// reconciliation/eligibility decisions used by the Mongo repair.
const remixRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
type NamespaceModule = typeof import('./namespace');
type ThingsModule = typeof import('../things/things');
type BehaviourSuitesModule = typeof import('../../../schemas/behaviourSuites');
let vite: Awaited<ReturnType<typeof createServer>>;
let APP_STORAGE_ACCOUNTING_VERSION: NamespaceModule['APP_STORAGE_ACCOUNTING_VERSION'];
let appStorageAdmissionLedgerDecision: NamespaceModule['appStorageAdmissionLedgerDecision'];
let appStorageCounterCrystalIsReady: NamespaceModule['appStorageCounterCrystalIsReady'];
let appStorageCounterEnvelopeIsTrusted: NamespaceModule['appStorageCounterEnvelopeIsTrusted'];
let appStorageCounterMatch: NamespaceModule['appStorageCounterMatch'];
let appStorageCounterProjectionIsReady: NamespaceModule['appStorageCounterProjectionIsReady'];
let appStorageCounterUpsertPlan: NamespaceModule['appStorageCounterUpsertPlan'];
let appStorageLedgerNeedsBaseline: NamespaceModule['appStorageLedgerNeedsBaseline'];
let appStorageReconciliationPlan: NamespaceModule['appStorageReconciliationPlan'];
let chargeAppStorage: NamespaceModule['chargeAppStorage'];
let historicalAppStorageCounterConversionPlan: NamespaceModule['historicalAppStorageCounterConversionPlan'];
let isAppStorageCounterCandidateId: NamespaceModule['isAppStorageCounterCandidateId'];
let orphanAppStorageReconciliationPlan: NamespaceModule['orphanAppStorageReconciliationPlan'];
let deletionStorageFenceDecision: ThingsModule['deletionStorageFenceDecision'];
let legacyInteractionLazyConversionIsSafe: ThingsModule['legacyInteractionLazyConversionIsSafe'];
let sanitizeShareId: ThingsModule['sanitizeShareId'];
let uncertainAppStorageLedgerMatch: ThingsModule['uncertainAppStorageLedgerMatch'];
let uncertainAppUserStorageLedgerMatch: ThingsModule['uncertainAppUserStorageLedgerMatch'];
let uncertainUserStorageLedgerMatch: ThingsModule['uncertainUserStorageLedgerMatch'];
let validateLegacyInteractionResidue: ThingsModule['validateLegacyInteractionResidue'];
let suiteDataShareId: BehaviourSuitesModule['suiteDataShareId'];

test.before(async () => {
	vite = await createServer({
		root: remixRoot,
		configFile: false,
		appType: 'custom',
		server: { middlewareMode: true },
		resolve: { alias: { '~': path.join(remixRoot, 'app') } }
	});
	const namespace = (await vite.ssrLoadModule('/app/api/utils/apps/namespace.ts')) as NamespaceModule;
	const thingsModule = (await vite.ssrLoadModule('/app/api/utils/things/things.ts')) as ThingsModule;
	({
	APP_STORAGE_ACCOUNTING_VERSION,
	appStorageAdmissionLedgerDecision,
	appStorageCounterCrystalIsReady,
	appStorageCounterEnvelopeIsTrusted,
	appStorageCounterMatch,
	appStorageCounterProjectionIsReady,
	appStorageCounterUpsertPlan,
	appStorageLedgerNeedsBaseline,
	appStorageReconciliationPlan,
	chargeAppStorage,
	historicalAppStorageCounterConversionPlan,
	isAppStorageCounterCandidateId,
	orphanAppStorageReconciliationPlan
	} = namespace);
	({
	deletionStorageFenceDecision,
	legacyInteractionLazyConversionIsSafe,
	sanitizeShareId,
	uncertainAppStorageLedgerMatch,
	uncertainAppUserStorageLedgerMatch,
	uncertainUserStorageLedgerMatch,
	validateLegacyInteractionResidue
	} = thingsModule);
	// app-suite registration is a module side effect, and it decides whether a
	// suite's parts slug as `demo-` or `app-` — load the registry first, or
	// suiteDataShareId('pokeworld') answers with the wrong namespace
	await vite.ssrLoadModule('/app/schemas/appSuites/index.ts');
	({ suiteDataShareId } = (await vite.ssrLoadModule('/app/schemas/behaviourSuites.ts')) as BehaviourSuitesModule);
});

test.after(async () => {
	await vite?.close();
});

test('non-transactional storage admission rejects registered app namespaces', async () => {
	const result = await chargeAppStorage({ appId: 'app-a', ownerId: 'user-a', sharedRead: false, scopes: [], username: '', sandbox: null }, 1);
	assert.equal(result.ok, false);
	if (result.ok === false) {
		assert.equal(result.status, 500);
		assert.match(result.error, /transactional content-write path/);
	}
});

test('an invalid sandbox marker fences account, app, and app-user ledgers on delete', () => {
	assert.deepEqual(deletionStorageFenceDecision({ appId: 'app-a', sandboxExpiresAt: 'not-a-date' } as any), {
		sandboxState: 'invalid',
		fenceAccount: true,
		fenceAppAndUser: true
	});
	assert.deepEqual(deletionStorageFenceDecision({ appId: 'app-a', sandboxExpiresAt: new Date() } as any), {
		sandboxState: 'sandbox',
		fenceAccount: false,
		fenceAppAndUser: false
	});
});

test('reconciliation plans exact aggregate, per-owner, and stale-zero totals', () => {
	const plan = appStorageReconciliationPlan(
		[
			{ _id: 'user-b', bytes: 20, invalid: 0 },
			{ _id: 'user-a', bytes: 10, invalid: 0 },
			{ _id: 'user-a', bytes: 5, invalid: 0 }
		],
		['user-c', 'user-b', 'user-a', 'user-c']
	);

	assert.deepEqual(plan, {
		usedBytes: 35,
		ownerTotals: [
			{ ownerId: 'user-a', usedBytes: 15 },
			{ ownerId: 'user-b', usedBytes: 20 }
		],
		staleOwnerIds: ['user-c']
	});
	assert.deepEqual(appStorageReconciliationPlan([], ['user-b', 'user-a']), {
		usedBytes: 0,
		ownerTotals: [],
		staleOwnerIds: ['user-a', 'user-b']
	});
});

test('reconciliation refuses malformed, sandbox, fractional, and unsafe source totals', () => {
	for (const rows of [
		[{ _id: 'user-a', bytes: 10, invalid: 1 }],
		[{ _id: 'sandbox:pretend', bytes: 10, invalid: 0 }],
		[{ _id: 'user-a', bytes: 1.5, invalid: 0 }],
		[{ _id: 'user-a', bytes: '10', invalid: 0 }],
		[
			{ _id: 'user-a', bytes: Number.MAX_SAFE_INTEGER, invalid: 0 },
			{ _id: 'user-a', bytes: 1, invalid: 0 }
		]
	]) {
		assert.throws(
			() => appStorageReconciliationPlan(rows),
			(error: any) => {
				assert.equal(error?.name, 'StorageMutationError');
				assert.equal(error?.code, 'storage_invariant');
				return true;
			}
		);
	}
});

test('automatic admission repairs only current-version needs-reconcile ledgers', () => {
	const current = APP_STORAGE_ACCOUNTING_VERSION;
	const ready = { storageAccountingVersion: current, storageLedgerStatus: 'ready' };
	const legacyReady = { storageAccountingVersion: current };
	const needs = { storageAccountingVersion: current, storageLedgerStatus: 'needs-reconcile' };

	assert.equal(appStorageAdmissionLedgerDecision(ready, ready), 'ready');
	assert.equal(appStorageAdmissionLedgerDecision(legacyReady, ready), 'blocked');
	assert.equal(appStorageAdmissionLedgerDecision(needs, ready), 'reconcile');
	assert.equal(appStorageAdmissionLedgerDecision(ready, needs), 'reconcile');
	assert.equal(appStorageAdmissionLedgerDecision({ storageAccountingVersion: current, storageLedgerStatus: 'initializing' }, needs), 'blocked');
	assert.equal(appStorageAdmissionLedgerDecision({ storageAccountingVersion: current - 1 }, needs), 'blocked');
	assert.equal(appStorageAdmissionLedgerDecision(needs, { storageLedgerStatus: 'ready' }), 'blocked');
	assert.equal(appStorageAdmissionLedgerDecision({ storageAccountingVersion: current, storageLedgerStatus: 'unexpected' }, ready), 'blocked');
});

test('migration baseline accepts absent and non-ready counters but skips current ready counters', () => {
	const current = APP_STORAGE_ACCOUNTING_VERSION;
	assert.equal(appStorageLedgerNeedsBaseline(undefined), true);
	assert.equal(appStorageLedgerNeedsBaseline({ storageAccountingVersion: current - 1 }), true);
	assert.equal(
		appStorageLedgerNeedsBaseline({
			storageAccountingVersion: current,
			storageLedgerStatus: 'needs-reconcile'
		}),
		true
	);
	assert.equal(
		appStorageLedgerNeedsBaseline({
			storageAccountingVersion: current,
			storageLedgerStatus: 'initializing'
		}),
		true
	);
	assert.equal(
		appStorageLedgerNeedsBaseline({
			storageAccountingVersion: current,
			storageLedgerStatus: 'ready'
		}),
		false
	);
});

test('app counter identity accepts only the complete protected server envelope', () => {
	const scope = {
		appId: 'app-a',
		ownerId: 'user-a',
		sharedRead: false,
		scopes: [],
		username: 'User A',
		sandbox: null
	};
	const match = appStorageCounterMatch(scope.ownerId, scope.appId);
	const now = new Date('2026-08-07T00:00:00.000Z');
	const trusted = {
		shareId: match.shareId,
		schemaVersion: match.schemaVersion,
		thingtime: ['app-storage'],
		ownerId: scope.ownerId,
		acl: ['tt:user'],
		targetId: null,
		tags: [],
		crystal: {
			quotaKind: 'app-storage',
			appId: scope.appId,
			usedBytes: 12,
			storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
			storageLedgerStatus: 'ready',
			storageUpdatedAt: now
		},
		storageLedgerEnvelopeVersion: match.storageLedgerEnvelopeVersion,
		createdAt: now,
		updatedAt: now
	};

	assert.equal(appStorageCounterEnvelopeIsTrusted(trusted, scope), true);
	assert.deepEqual(match.thingtime, ['app-storage']);
	assert.equal(match['crystal.appId'], scope.appId);
	assert.deepEqual(match.sizeBytes, { $exists: false });

	for (const untrusted of [
		{ ...trusted, thingtime: ['data'] },
		{ ...trusted, sizeBytes: 1, storageClass: 'content', storageAccountingVersion: 1 },
		{ ...trusted, appId: scope.appId },
		{ ...trusted, shareId: `${match.shareId}-wrong` },
		{ ...trusted, crystal: { ...trusted.crystal, appId: 'other-app' } },
		{ ...trusted, crystal: { ...trusted.crystal, usedBytes: -1 } },
		{ ...trusted, crystal: { ...trusted.crystal, storageLedgerStatus: undefined } },
		{ ...trusted, extended: null },
		{ ...trusted, crystal: { ...trusted.crystal, unexpected: true } }
	]) {
		assert.equal(appStorageCounterEnvelopeIsTrusted(untrusted, scope), false);
	}
});

test('app counter creation uses an upsert-safe deterministic match and a complete protected envelope', () => {
	const now = new Date('2026-08-08T00:00:00.000Z');
	const registeredScope = {
		appId: 'app-a',
		ownerId: 'user-a',
		sharedRead: false,
		scopes: [],
		username: 'User A',
		sandbox: null
	};
	const plan = appStorageCounterUpsertPlan(registeredScope, now);

	assert.deepEqual(plan.match, { shareId: appStorageCounterMatch('user-a', 'app-a').shareId });
	assert.equal(JSON.stringify(plan.match).includes('$expr'), false);
	assert.deepEqual(plan.setOnInsert.thingtime, ['app-storage']);
	assert.equal(plan.setOnInsert.ownerId, 'user-a');
	assert.equal(plan.setOnInsert.crystal.appId, 'app-a');
	assert.equal(plan.setOnInsert.crystal.usedBytes, 0);
	assert.equal(plan.setOnInsert.crystal.storageLedgerStatus, 'needs-reconcile');
	assert.equal(plan.setOnInsert.createdAt, now);

	const insertedEnvelope = { shareId: plan.match.shareId, ...plan.setOnInsert };
	assert.equal(appStorageCounterEnvelopeIsTrusted(insertedEnvelope, registeredScope), true);

	const sandboxScope = { ...registeredScope, ownerId: 'sandbox:test', sandbox: { space: null } };
	const sandboxPlan = appStorageCounterUpsertPlan(sandboxScope, now);
	assert.equal(sandboxPlan.setOnInsert.crystal.storageLedgerStatus, 'ready');
	assert.equal(sandboxPlan.setOnInsert.crystal.storageReconciledAt, now);
	assert.equal(sandboxPlan.setOnInsert.sandboxExpiresAt instanceof Date, true);
	assert.equal(
		appStorageCounterEnvelopeIsTrusted({ shareId: sandboxPlan.match.shareId, ...sandboxPlan.setOnInsert }, sandboxScope),
		true
	);
});

test('counter readiness rejects malformed usage, overrides, and extra payload', () => {
	const ready = {
		quotaKind: 'app-storage',
		appId: 'app-a',
		usedBytes: 0,
		storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
		storageLedgerStatus: 'ready'
	};
	assert.equal(appStorageCounterCrystalIsReady(ready), true);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, usedBytes: '0' }), false);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, usedBytes: -1 }), false);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, storageAllowanceBytes: '10' }), false);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, storageAllowanceBytes: -1 }), false);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, storageAllowanceBytes: 10 }), true);
	assert.equal(appStorageCounterCrystalIsReady({ ...ready, unexpected: true }), false);

	const registeredScope = {
		appId: 'app-a',
		ownerId: 'user-a',
		sharedRead: false,
		scopes: [],
		username: '',
		sandbox: null
	};
	assert.equal(appStorageCounterProjectionIsReady(null, registeredScope), false);
	assert.equal(appStorageCounterProjectionIsReady(null, { ...registeredScope, ownerId: 'sandbox:test', sandbox: { space: null } }), false);
});

test('historical counters convert only from an exact envelope and discard owner-editable totals', () => {
	const now = new Date('2026-08-07T01:00:00.000Z');
	const createdAt = new Date('2026-08-01T00:00:00.000Z');
	const match = appStorageCounterMatch('user-a', 'app-a');
	const legacy = {
		shareId: match.shareId,
		schemaVersion: match.schemaVersion,
		thingtime: ['data'],
		crystal: {
			quotaKind: 'app-storage',
			appId: 'app-a',
			usedBytes: 999_999,
			storageAllowanceBytes: 999_999
		},
		ownerId: 'user-a',
		acl: ['tt:user'],
		targetId: null,
		tags: [],
		createdAt,
		updatedAt: createdAt
	};

	const plan = historicalAppStorageCounterConversionPlan(legacy, 'user-a', 'app-a', { now });
	assert.equal(plan.replacement.crystal.usedBytes, 0);
	assert.equal(plan.replacement.crystal.storageLedgerStatus, 'needs-reconcile');
	assert.equal(Object.prototype.hasOwnProperty.call(plan.replacement.crystal, 'storageAllowanceBytes'), false);
	assert.equal(plan.replacement.storageLedgerEnvelopeVersion, match.storageLedgerEnvelopeVersion);
	assert.deepEqual(plan.replacement.thingtime, ['app-storage']);

	const trusted = historicalAppStorageCounterConversionPlan(legacy, 'user-a', 'app-a', {
		now,
		trustedAllowanceBytes: 1234
	});
	assert.equal(trusted.replacement.crystal.storageAllowanceBytes, 1234);

	for (const collision of [
		{ ...legacy, extended: null },
		{ ...legacy, shareId: `${legacy.shareId}-wrong` },
		{ ...legacy, ownerId: 'other-user' },
		{ ...legacy, crystal: { ...legacy.crystal, extra: true } },
		{ ...legacy, crystal: { ...legacy.crystal, usedBytes: '1' } }
	]) {
		assert.throws(
			() => historicalAppStorageCounterConversionPlan(collision, 'user-a', 'app-a', { now }),
			(error: any) => error?.name === 'StorageMutationError' && error?.code === 'storage_invariant'
		);
	}
});

test('orphan app reconciliation plans exact owner sums and zeroes stale counters', () => {
	assert.equal(isAppStorageCounterCandidateId('ordinary-content'), false);
	assert.equal(isAppStorageCounterCandidateId('app-storage-forged-candidate'), true);
	assert.deepEqual(
		orphanAppStorageReconciliationPlan(
			[
				{ _id: 'user-a', bytes: 10, invalid: 0 },
				{ _id: 'user-b', bytes: 25, invalid: 0 }
			],
			['user-a', 'user-c']
		),
		{
			usedBytes: 35,
			ownerTotals: [
				{ ownerId: 'user-a', usedBytes: 10 },
				{ ownerId: 'user-b', usedBytes: 25 }
			],
			staleOwnerIds: ['user-c']
		}
	);
});

test('generic Thing ids cannot squat protected control-plane namespaces', () => {
	const blocked: any = sanitizeShareId('app-storage-attacker-controlled');
	assert.equal(blocked?.ok, false);
	assert.equal(blocked?.status, 400);
	const diagnostic: any = sanitizeShareId('migration-diagnostic-attacker-controlled');
	assert.equal(diagnostic?.ok, false);
	assert.equal(diagnostic?.status, 400);
	assert.equal(sanitizeShareId('ordinary-user-thing'), 'ordinary-user-thing');
});

// The demo/app seed is the only seeder that mints DATA things, and
// upsertSystemThings will not touch a twin it does not own: a squatted
// destination id is skipped on every future run, so the reservation is the
// only thing keeping a seeded row reachable. Derived from the minting helper
// rather than hardcoded, so renaming the prefix without reserving it fails
// here instead of silently reopening the namespace.
test('generic Thing ids cannot squat seeded suite/app data destinations', () => {
	const suiteSample: any = sanitizeShareId(suiteDataShareId('tickets', 0));
	assert.equal(suiteSample?.ok, false);
	assert.equal(suiteSample?.status, 400);
	const appSample: any = sanitizeShareId(suiteDataShareId('pokeworld', 0));
	assert.equal(appSample?.ok, false);
	assert.equal(appSample?.status, 400);
	// app content rides the same data-app- namespace as the app suites
	const appContent: any = sanitizeShareId('data-app-pokeworld-species-25');
	assert.equal(appContent?.ok, false);
	assert.equal(appContent?.status, 400);
	// …and the reservation stays narrow: ordinary data ids are still the user's
	assert.equal(sanitizeShareId('data-my-notes'), 'data-my-notes');
	assert.equal(sanitizeShareId('database-backup'), 'database-backup');
});

test('uncertain delete fencing matches every current ledger status', () => {
	const matches = [
		uncertainUserStorageLedgerMatch('user-a'),
		uncertainAppStorageLedgerMatch('app-a'),
		uncertainAppUserStorageLedgerMatch('user-a', 'app-a')
	];
	for (const match of matches) {
		assert.equal(Object.prototype.hasOwnProperty.call(match, 'crystal.storageLedgerStatus'), false);
	}
	assert.equal(typeof uncertainUserStorageLedgerMatch('user-a')['crystal.storageAccountingVersion'], 'number');
	assert.equal(uncertainAppStorageLedgerMatch('app-a')['crystal.storageAccountingVersion'], APP_STORAGE_ACCOUNTING_VERSION);
});

test('legacy interaction conversion validates the complete residue before planning children', () => {
	const createdAt = new Date('2026-08-07T00:00:00.000Z');
	const plan = validateLegacyInteractionResidue({
		shareId: 'post-a',
		createdAt,
		reactions: { '👍': ['user-b'], '🔥': ['user-a'] },
		comments: [{ id: 'comment-a', userId: 'user-c', text: 'hello', createdAt }]
	} as any);

	assert.equal(plan.ok, true);
	if (!plan.ok) return;
	assert.equal(legacyInteractionLazyConversionIsSafe(plan), false);
	assert.deepEqual(plan.ownerIds, ['user-a', 'user-b', 'user-c']);
	assert.deepEqual(
		plan.reactions.map(({ ownerId, emoji }) => ({ ownerId, emoji })),
		[
			{ ownerId: 'user-b', emoji: '👍' },
			{ ownerId: 'user-a', emoji: '🔥' }
		]
	);
	assert.deepEqual(plan.comments, [{ shareId: 'comment-a', ownerId: 'user-c', text: 'hello', createdAt }]);
});

test('legacy interaction conversion fails closed on every malformed residue shape', () => {
	const createdAt = new Date('2026-08-07T00:00:00.000Z');
	const malformed = [
		{ shareId: 'post-a', createdAt, reactions: { '👍': 'user-a' } },
		{ shareId: 'post-a', createdAt, reactions: { '👍': [''] } },
		{ shareId: 'post-a', createdAt, reactions: { words: ['user-a'] } },
		{ shareId: 'post-a', createdAt: 'not-a-date', reactions: { '👍': ['user-a'] } },
		{ shareId: 'post-a', createdAt, comments: {} },
		{ shareId: 'post-a', createdAt, comments: [{ id: '', userId: 'user-a', text: 'x', createdAt }] },
		{ shareId: 'post-a', createdAt, comments: [{ id: 'comment-a', userId: '', text: 'x', createdAt }] },
		{ shareId: 'post-a', createdAt, comments: [{ id: 'comment-a', userId: 'user-a', text: 1, createdAt }] },
		{ shareId: 'post-a', createdAt, comments: [{ id: 'comment-a', userId: 'user-a', text: 'x', createdAt: null }] },
		{
			shareId: 'post-a',
			createdAt,
			comments: [
				{ id: 'comment-a', userId: 'user-a', text: 'x', createdAt },
				{ id: 'comment-a', userId: 'user-b', text: 'y', createdAt }
			]
		}
	];

	for (const residue of malformed) assert.equal(validateLegacyInteractionResidue(residue as any).ok, false);
	const empty = validateLegacyInteractionResidue({ shareId: 'post-a', reactions: null, comments: null } as any);
	assert.equal(empty.ok, true);
	assert.equal(legacyInteractionLazyConversionIsSafe(empty), true);
});
