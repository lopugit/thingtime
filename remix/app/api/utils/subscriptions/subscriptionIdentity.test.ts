import assert from 'node:assert/strict';
import test from 'node:test';
import { QUOTA_OVERRIDE_FIELDS, REQUIRED_TIER_QUOTA_FIELDS, SUBSCRIPTION_TIER_CATALOG } from './tierCatalog.ts';

import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, USER_STORAGE_LEDGER_ENVELOPE_VERSION } from '../../../schemas/registry.ts';
import {
	legacyUserSubscriptionLedgerEnvelopeCanUpgrade,
	subscriptionShareId,
	userSubscriptionLedgerEnvelopeIsTrusted,
	userSubscriptionLedgerEnvelopeIssues,
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

test('all canonical tier snapshots and optional speed-test overrides preserve current and legacy envelopes', () => {
	for (const tier of SUBSCRIPTION_TIER_CATALOG) {
		for (const speedTestsPerHour of [undefined, null, 0, 4, 1000]) {
			const doc: any = canonicalLedger();
			doc.crystal.tierQuotas = { ...tier.quotas };
			doc.crystal.overrides = speedTestsPerHour === undefined ? null : { speedTestsPerHour };
			if (speedTestsPerHour === undefined) delete doc.crystal.tierQuotas.speedTestsPerHour;
			else doc.crystal.tierQuotas.speedTestsPerHour = speedTestsPerHour;
			const before = structuredClone(doc);
			assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(doc, 'user-1'), true);
			assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(doc, 'user-1'), []);
			assert.deepEqual(doc, before, 'validation must not rewrite assignments');
			const { storageLedgerEnvelopeVersion: _marker, ...legacy } = doc;
			assert.equal(legacyUserSubscriptionLedgerEnvelopeCanUpgrade(legacy, 'user-1'), true);
			assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(legacy, 'user-1'), []);
		}
	}
});

test('stored quotas reject malformed values without coercion or clamping in either envelope', () => {
	for (const container of ['tierQuotas', 'overrides']) {
		for (const key of QUOTA_OVERRIDE_FIELDS) {
			for (const invalid of [undefined, '4', -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, [], true, ...(key === 'speedTestsPerHour' ? [1001] : [])]) {
				const doc: any = canonicalLedger();
				doc.crystal[container] = { ...(doc.crystal[container] ?? {}), [key]: invalid };
				assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(doc, 'user-1'), false, `${container}.${key}`);
				assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(doc, 'user-1'), [`crystal.${container}`]);
				const { storageLedgerEnvelopeVersion: _marker, ...legacy } = doc;
				assert.equal(legacyUserSubscriptionLedgerEnvelopeCanUpgrade(legacy, 'user-1'), false);
			}
		}
		const doc: any = canonicalLedger();
		doc.crystal[container] = { ...(doc.crystal[container] ?? {}), unknownQuota: 1 };
		assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(doc, 'user-1'), false);
		assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(doc, 'user-1'), [`crystal.${container}`]);
	}
	for (const key of REQUIRED_TIER_QUOTA_FIELDS) {
		const doc: any = canonicalLedger();
		delete doc.crystal.tierQuotas[key];
		assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(doc, 'user-1'), false);
		assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(doc, 'user-1'), ['crystal.tierQuotas']);
	}
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

test('operator diagnostics identify invalid fields without disclosing values or arbitrary key names', () => {
	const canonical = canonicalLedger();
	assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(canonical, 'user-1'), []);
	const { storageLedgerEnvelopeVersion: _marker, ...legacy } = canonical;
	assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(legacy, 'user-1'), []);
	const malformed = {
		...legacy,
		extended: { private: 'never disclose' },
		'secret-in-a-key-name': 'never disclose',
		crystal: { ...legacy.crystal, tierVersionId: null, note: { private: 'never disclose' } }
	};
	assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(malformed, 'user-1'), [
		'root.fields',
		'root.unexpected.extended',
		'crystal.tierVersionId',
		'crystal.note'
	]);
	assert.equal(legacyUserSubscriptionLedgerEnvelopeCanUpgrade(malformed, 'user-1'), false);
	assert.equal(JSON.stringify(userSubscriptionLedgerEnvelopeIssues(malformed, 'user-1')).includes('secret'), false);
});

test('diagnostics cover every canonical envelope predicate and stay bounded on malformed input', () => {
	for (const rootKey of Object.keys(canonicalLedger()).filter((key) => key !== '_id')) {
		const malformed: any = { ...canonicalLedger(), [rootKey]: 'invalid-value' };
		assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(malformed, 'user-1'), false, rootKey);
		assert.ok(userSubscriptionLedgerEnvelopeIssues(malformed, 'user-1').length, rootKey);
	}
	for (const key of [
		'tier',
		'tierVersionId',
		'tierVersion',
		'tierName',
		'tierMetered',
		'tierQuotas',
		'overrides',
		'note',
		'updatedBy',
		'isDefaultAssignment'
	]) {
		const malformed = canonicalLedger();
		(malformed.crystal as any)[key] = undefined;
		assert.equal(userSubscriptionLedgerEnvelopeIsTrusted(malformed, 'user-1'), false, key);
		assert.ok(userSubscriptionLedgerEnvelopeIssues(malformed, 'user-1').includes(`crystal.${key}`), key);
	}
	assert.deepEqual(userSubscriptionLedgerEnvelopeIssues(null, 'user-1'), ['root.object']);
	assert.ok(userSubscriptionLedgerEnvelopeIssues({}, 'user-1').length < 40);
});
