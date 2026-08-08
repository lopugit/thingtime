import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	buildConservativeLegacyServiceQuotaThing,
	classifyLegacyServiceQuotaThing,
	quotaShareId,
	requireCanonicalServiceQuotaDocumentState,
	validatedServiceQuotaDocumentState
} from './quotaLegacyCore.ts';
// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { isConsistentServiceQuotaState } from './quotaCore.ts';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');
const ownerId = 'user-1';
const key = 'pokeworld:block-generation';
const policy = { dailyLimit: 3, rollingLimit: 2, rollingWindowMs: 5_000 };

const exactLegacyThing = () => {
	const canonical = buildConservativeLegacyServiceQuotaThing({ ownerId, key, policy }, NOW);
	return {
		_id: 'legacy-object-id',
		shareId: canonical.shareId,
		schemaVersion: canonical.schemaVersion,
		thingtime: ['data'],
		crystal: canonical.crystal,
		ownerId: canonical.ownerId,
		acl: canonical.acl,
		targetId: canonical.targetId,
		tags: canonical.tags,
		createdAt: canonical.createdAt,
		updatedAt: canonical.updatedAt
	};
};

test('only an exact deterministic historical envelope is eligible for rebuild', () => {
	assert.deepEqual(classifyLegacyServiceQuotaThing(exactLegacyThing()), {
		disposition: 'rebuild',
		ownerId,
		key,
		policy
	});
	assert.deepEqual(classifyLegacyServiceQuotaThing({ ...exactLegacyThing(), extended: { arbitraryPayload: true } }), {
		disposition: 'quarantine',
		reason: 'noncanonical-envelope'
	});
	assert.deepEqual(
		classifyLegacyServiceQuotaThing({ ...exactLegacyThing(), extended: null }),
		{ disposition: 'quarantine', reason: 'noncanonical-envelope' },
		'even an innocuous-looking generic data field proves this is not the exact historical server envelope'
	);
	assert.deepEqual(
		classifyLegacyServiceQuotaThing({
			...exactLegacyThing(),
			crystal: { ...exactLegacyThing().crystal, arbitraryPayload: 'must remain billable' }
		}),
		{ disposition: 'quarantine', reason: 'noncanonical-envelope' }
	);
	assert.deepEqual(classifyLegacyServiceQuotaThing({ ...exactLegacyThing(), shareId: 'attacker-selected-id' }), {
		disposition: 'quarantine',
		reason: 'identity-mismatch'
	});
	assert.deepEqual(classifyLegacyServiceQuotaThing({ ...exactLegacyThing(), thingtime: 'data' }), {
		disposition: 'quarantine',
		reason: 'noncanonical-envelope'
	});
	assert.deepEqual(classifyLegacyServiceQuotaThing({ thingtime: ['data'], crystal: { message: 'ordinary' } }), {
		disposition: 'ignore'
	});
});

test('exact envelopes with poisoned quota state stay billable and fail closed', () => {
	const legacy = exactLegacyThing();
	const poisoned = {
		...legacy,
		crystal: {
			...legacy.crystal,
			permitIds: ['unrelated-reservation:permit']
		}
	};
	assert.deepEqual(classifyLegacyServiceQuotaThing(poisoned), {
		disposition: 'quarantine',
		reason: 'invalid-state'
	});
});

test('missing required quota histories fail validation without repairing the preimage', () => {
	for (const field of ['reservations', 'permitIds', 'releasedIds', 'rollingPermits'] as const) {
		const malformed = buildConservativeLegacyServiceQuotaThing({ ownerId, key, policy }, NOW);
		delete malformed.crystal[field];
		const before = structuredClone(malformed);
		assert.equal(validatedServiceQuotaDocumentState(malformed), null, `${field} must be required`);
		assert.throws(
			() => requireCanonicalServiceQuotaDocumentState(malformed, ownerId, key),
			(error: any) => error?.code === 'QUOTA_UNAVAILABLE',
			`${field} must fail closed`
		);
		assert.deepEqual(malformed, before, `${field} validation must be read-only`);
	}
});

test('a valid state stored at another key identity fails closed without mutation', () => {
	const malformed = buildConservativeLegacyServiceQuotaThing({ ownerId, key, policy }, NOW);
	malformed.crystal.key = 'different-service:key';
	const before = structuredClone(malformed);
	assert.throws(
		() => requireCanonicalServiceQuotaDocumentState(malformed, ownerId, key),
		(error: any) => error?.code === 'QUOTA_UNAVAILABLE'
	);
	assert.deepEqual(malformed, before);
});

test('conservative rebuild creates a fresh fully consumed canonical control Thing', () => {
	const rebuilt = buildConservativeLegacyServiceQuotaThing({ ownerId, key, policy }, NOW);
	assert.equal(rebuilt.shareId, quotaShareId(ownerId, key));
	assert.deepEqual(rebuilt.thingtime, ['service-quota']);
	assert.equal(rebuilt.storageClass, 'control');
	assert.equal(rebuilt.crystal.dailyUsed, policy.dailyLimit);
	assert.equal(rebuilt.crystal.rollingPermits.length, policy.rollingLimit);
	assert.equal(rebuilt.crystal.reservations.length, 1);
	assert.equal(rebuilt.crystal.reservations[0].count, policy.dailyLimit);
	assert.equal(
		isConsistentServiceQuotaState({
			key: rebuilt.crystal.key,
			policy: rebuilt.crystal.policy,
			dayKey: rebuilt.crystal.dayKey,
			dailyUsed: rebuilt.crystal.dailyUsed,
			reservations: rebuilt.crystal.reservations,
			permitIds: rebuilt.crystal.permitIds,
			releasedIds: rebuilt.crystal.releasedIds,
			rollingPermits: rebuilt.crystal.rollingPermits
		}),
		true
	);
	assert.deepEqual(Object.keys(rebuilt).sort(), [
		'acl',
		'createdAt',
		'crystal',
		'ownerId',
		'schemaVersion',
		'shareId',
		'storageClass',
		'tags',
		'targetId',
		'thingtime',
		'updatedAt'
	]);
});
