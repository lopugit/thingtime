import assert from 'node:assert/strict';
import test from 'node:test';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity.ts';
import { USER_STORAGE_ACCOUNTING_VERSION, USER_STORAGE_STATUS } from './storageCore.ts';
import { userStorageLedgersAreReady } from './userStorageReadiness.ts';

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
			storageLedgerStatus: USER_STORAGE_STATUS.ready,
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
