import assert from 'node:assert/strict';
import test from 'node:test';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import {
	legacyUserSubscriptionLedgerEnvelopeCanUpgrade,
	subscriptionShareId,
	userSubscriptionLedgerEnvelopeIsTrusted,
	userSubscriptionLedgerMatch
} from './subscriptionIdentity.ts';

const canonicalLedger = (subjectId = 'user-1') => {
	const now = new Date('2026-08-07T00:00:00.000Z');
	return {
		_id: 'mongo-id',
		shareId: subscriptionShareId('user', subjectId),
		schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
		thingtime: ['subscription'],
		crystal: {
			quotaKind: 'subscription',
			subjectType: 'user',
			subjectId,
			tier: 'free',
			tierVersionId: 'free-v1',
			tierVersion: 1,
			tierName: 'Free',
			tierMetered: true,
			tierQuotas: { appStorageBytes: 1024, userStorageBytes: 1024, maxApps: 2, maxPats: 2 },
			overrides: null,
			note: null,
			updatedBy: 'system',
			isDefaultAssignment: true,
			storageUsedBytes: 12,
			storageAccountingVersion: 1,
			storageLedgerStatus: 'ready',
			storageReconciledAt: now,
			storageUpdatedAt: now
		},
		ownerId: subjectId,
		acl: [ACL_OWNER],
		targetId: null,
		tags: [],
		storageLedgerEnvelopeVersion: USER_STORAGE_LEDGER_ENVELOPE_VERSION,
		createdAt: now,
		updatedAt: now
	};
};

test('only the exact protected user subscription envelope is trusted', () => {
	const canonical = canonicalLedger();
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(canonical, 'user-1'), true);
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted({ ...canonical, ownerId: 'user-2' }, 'user-1'), false);
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted({ ...canonical, crystal: { ...canonical.crystal, subjectId: 'user-2' } }, 'user-1'), false);
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted({ ...canonical, ownerEditable: true }, 'user-1'), false);
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted({ ...canonical, crystal: { ...canonical.crystal, extraCounter: 12 } }, 'user-1'), false);
});

test('migration upgrades only the exact old server envelope', () => {
	const { storageLedgerEnvelopeVersion: _marker, ...legacy } = canonicalLedger();
	assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(legacy, 'user-1'), false);
	assert.equal(legacyUserSubscriptionLedgerEnvelopeCanUpgrade(legacy, 'user-1'), true);
	assert.equal(legacyUserSubscriptionLedgerEnvelopeCanUpgrade({ ...legacy, unexpected: true }, 'user-1'), false);
	assert.equal(
		legacyUserSubscriptionLedgerEnvelopeCanUpgrade({ ...legacy, crystal: { ...legacy.crystal, subjectId: 'other-user' } }, 'user-1'),
		false
	);
});

test('hot Mongo match pins the same deterministic identity and proof marker', () => {
	const match = userSubscriptionLedgerMatch('user-1') as any;
	assert.equal(match.shareId, subscriptionShareId('user', 'user-1'));
	assert.deepEqual(match.thingtime, ['subscription']);
	assert.equal(match.ownerId, 'user-1');
	assert.equal(match['crystal.subjectId'], 'user-1');
	assert.equal(match.storageLedgerEnvelopeVersion, USER_STORAGE_LEDGER_ENVELOPE_VERSION);
});
