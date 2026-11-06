import assert from 'node:assert/strict';
import test from 'node:test';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, STORAGE_RECOVERY_THINGTIME, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity.ts';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from './storageCore.ts';
import { userStorageLedgersAreReady, userStorageLedgersState } from './userStorageReadiness.ts';
import { userStorageRecoveryId } from './userStorageRecovery.ts';

const ledger = (ownerId: string, overrides: Record<string, number | null> | null = null) => {
	const now = new Date('2026-09-03T00:00:00.000Z');
	return {
		shareId: subscriptionShareId('user', ownerId),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: ['subscription'],
		crystal: {
			quotaKind: 'subscription',
			subjectType: 'user',
			subjectId: ownerId,
			tier: 'free',
			tierVersionId: 'free-v1',
			tierVersion: 1,
			tierName: 'Free',
			tierMetered: false,
			tierQuotas: { appStorageBytes: 1, userStorageBytes: 1, maxApps: 1, maxPats: 1 },
			overrides,
			note: null,
			updatedBy: null,
			isDefaultAssignment: true,
			storageUsedBytes: 0,
			storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
			storageLedgerStatus: USER_STORAGE_STATUS.ready as string,
			storageReconciledAt: now,
			storageUpdatedAt: now
		},
		ownerId,
		acl: [ACL_OWNER],
		targetId: null,
		tags: [],
		storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
		createdAt: now,
		updatedAt: now
	};
};

test('storage readiness requires one exact current ready ledger per user', () => {
	const one = ledger('user-1');
	const two = ledger('user-2', { userStorageBytes: null });
	assert.equal(userStorageLedgersAreReady(['user-1', 'user-2'], [one, two]), true);
	assert.equal(userStorageLedgersAreReady([], []), true);
	assert.equal(userStorageLedgersAreReady(['user-1', 'user-1'], [one]), true);
	assert.equal(userStorageLedgersAreReady(['user-1', 'user-2'], [one]), false);
	assert.equal(userStorageLedgersAreReady(['user-1'], [{ ...one, crystal: { ...one.crystal, storageAccountingVersion: 1 } }]), false);
	assert.equal(
		userStorageLedgersAreReady(['user-1'], [{ ...one, crystal: { ...one.crystal, storageLedgerStatus: USER_STORAGE_STATUS.initializing } }]),
		false
	);
	assert.equal(userStorageLedgersAreReady(['user-1'], [{ ...one, crystal: { ...one.crystal, storageUsedBytes: -1 } }]), false);
	assert.equal(userStorageLedgersAreReady(['user-1'], [{ ...one, unexpected: true }]), false);
});

test('storage source readiness refuses even one legacy or malformed billable counterexample', async () => {
	const { userStorageSourcesAreReady } = await import('./userStorageReadiness.ts');
	const { billableStorageCandidateExpression, currentStorageSourceMatch } = await import('./storageCore.ts');
	let received: any;
	let options: any;
	let counterexample: { _id: string } | null = { _id: 'legacy-source' };
	const things = { findOne: async (filter: any, projection: any) => {
		received = filter;
		options = projection;
		return counterexample;
	} };
	assert.equal(await userStorageSourcesAreReady(things), false);
	assert.deepEqual(received.$expr, billableStorageCandidateExpression);
	assert.deepEqual(received.$nor, [currentStorageSourceMatch], 'release readiness uses the same proof as transactional reconciliation');
	assert.equal(received.ownerId.$type, 'string');
	assert.equal(received.ownerId.$ne, '');
	assert.equal(received.ownerId.$not.test('sandbox:owner'), true);
	assert.equal(received.ownerId.$not.test('ordinary-owner'), false);
	assert.deepEqual(options, { projection: { _id: 1 }, maxTimeMS: 5_000 }, 'readiness bounds the scan and never returns protected content');
	counterexample = null;
	assert.equal(await userStorageSourcesAreReady(things), true);
});

test('recovery health requires a trusted durable live job and never labels queued accounting ready', () => {
	const now = new Date('2026-10-29T00:00:00Z');
	const one = ledger('user-1', { userStorageBytes: null });
	const job = {
		shareId: userStorageRecoveryId('user-1'), ownerId: 'user-1', thingtime: [STORAGE_RECOVERY_THINGTIME],
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, acl: [ACL_OWNER], storageClass: 'control', tags: [], targetId: null,
		createdAt: now, updatedAt: now,
		crystal: { quotaKind: STORAGE_RECOVERY_THINGTIME, status: 'queued', attempts: 0, generation: 1, revision: 0, nextAttemptAt: now }
	};
	assert.equal(userStorageLedgersState(['user-1'], [one], []), 'ready');
	one.crystal.storageLedgerStatus = USER_STORAGE_STATUS.needsReconcile;
	Object.assign(one.crystal, { storagePendingBytes: 16, storagePendingCount: 1, storagePendingSince: now });
	assert.equal(userStorageLedgersState(['user-1'], [one], [job], now), 'recovering');
	assert.equal(userStorageLedgersState(['user-1'], [one], [], now), 'migration-required');
	for (const status of ['blocked', 'ready']) {
		assert.equal(userStorageLedgersState(['user-1'], [one], [{ ...job, crystal: { ...job.crystal, status } }], now), 'migration-required');
	}
	const expired = { ...job, crystal: { ...job.crystal, status: 'running', leaseId: 'test', leaseUntil: now } };
	assert.equal(userStorageLedgersState(['user-1'], [one], [expired], now), 'migration-required');
	assert.equal(userStorageLedgersState(['user-1', 'missing'], [one], [job], now), 'migration-required');
	one.crystal.storageLedgerStatus = USER_STORAGE_STATUS.ready;
	assert.equal(userStorageLedgersState(['user-1'], [one], [job], now), 'migration-required', 'queued deltas cannot coexist with an exact-ready health claim');
});
