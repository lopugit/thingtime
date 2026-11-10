import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
	SERVICE_QUOTA_MAX_CHILD_HISTORY,
  assertServiceQuotaChildId,
  createServiceQuotaState,
	isConsistentServiceQuotaState,
  normalizeServiceQuotaState,
  parseServiceQuotaKey,
  parseServiceQuotaPolicy,
  permitServiceQuotaState,
  releaseServiceQuotaState,
  reserveServiceQuotaState,
  resetServiceQuotaState,
  ServiceQuotaError,
  serviceQuotaStatus
} from './quotaCore.ts';

const DAY = Date.parse('2026-07-19T12:00:00.000Z');
const policy = { dailyLimit: 3, rollingLimit: 2, rollingWindowMs: 5_000 };

const expectQuotaError = (operation: () => unknown, code: string) => {
  assert.throws(operation, (error: unknown) => error instanceof ServiceQuotaError && error.code === code);
};

test('validates bounded keys, policies, and Pokeworld coordinate child ids', () => {
  assert.equal(parseServiceQuotaKey('pokeworld:block-generation'), 'pokeworld:block-generation');
  assert.deepEqual(parseServiceQuotaPolicy(policy), policy);
	assert.equal(assertServiceQuotaChildId('permitId', 'reservation-1', 'reservation-1:-946647,488524'), 'reservation-1:-946647,488524');
  expectQuotaError(() => parseServiceQuotaKey('../escape'), 'INVALID_REQUEST');
	expectQuotaError(() => parseServiceQuotaPolicy({ dailyLimit: 0, rollingLimit: 2, rollingWindowMs: 5_000 }), 'INVALID_REQUEST');
	expectQuotaError(() => assertServiceQuotaChildId('permitId', 'reservation-1', 'reservation-2:1,1'), 'QUOTA_PERMIT_CONFLICT');
});

test('reserve is idempotent, rejects conflicting counts, and stops at the daily cap', () => {
  const initial = createServiceQuotaState('pokeworld', policy, DAY);
	const first = reserveServiceQuotaState(initial, { reservationId: 'reservation-1', count: 2, policy }, DAY);
	const replay = reserveServiceQuotaState(first.state, { reservationId: 'reservation-1', count: 2, policy }, DAY + 1);
  assert.equal(replay.state.dailyUsed, 2);
  assert.equal(replay.state.reservations.length, 1);

  expectQuotaError(
		() => reserveServiceQuotaState(replay.state, { reservationId: 'reservation-1', count: 1, policy }, DAY + 2),
    'QUOTA_RESERVATION_CONFLICT'
  );
	expectQuotaError(() => reserveServiceQuotaState(replay.state, { reservationId: 'reservation-2', count: 2, policy }, DAY + 2), 'QUOTA_DAILY_LIMIT');
});

test('reservation namespaces cannot overlap', () => {
	const initial = createServiceQuotaState('pokeworld', policy, DAY);
	const reserved = reserveServiceQuotaState(initial, { reservationId: 'reservation-1', count: 1, policy }, DAY).state;

  expectQuotaError(
		() => reserveServiceQuotaState(reserved, { reservationId: 'reservation-1:nested', count: 1, policy }, DAY + 1),
		'QUOTA_RESERVATION_CONFLICT'
	);

	const reverse = reserveServiceQuotaState(initial, { reservationId: 'reservation-1:nested', count: 1, policy }, DAY).state;
	expectQuotaError(
		() => reserveServiceQuotaState(reverse, { reservationId: 'reservation-1', count: 1, policy }, DAY + 1),
		'QUOTA_RESERVATION_CONFLICT'
  );
});

test('the first policy stays pinned and mismatches never mutate usage', () => {
  const initial = createServiceQuotaState('pokeworld', policy, DAY);
  expectQuotaError(
    () =>
      reserveServiceQuotaState(
        initial,
        {
          reservationId: 'reservation-1',
          count: 1,
          policy: { ...policy, dailyLimit: 4 }
        },
        DAY
      ),
    'QUOTA_POLICY_CONFLICT'
  );
  assert.equal(initial.dailyUsed, 0);
});

test('rolling permits grant exactly the cap, retry deterministically, and remain idempotent', () => {
  const reserved = reserveServiceQuotaState(
    createServiceQuotaState('pokeworld', policy, DAY),
    { reservationId: 'reservation-1', count: 3, policy },
    DAY
  ).state;
	const first = permitServiceQuotaState(reserved, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, DAY);
	const second = permitServiceQuotaState(first.state, { reservationId: 'reservation-1', permitId: 'reservation-1:1,2' }, DAY + 1);
	const denied = permitServiceQuotaState(second.state, { reservationId: 'reservation-1', permitId: 'reservation-1:1,3' }, DAY + 2);
  assert.deepEqual(denied.permit, {
    permitId: 'reservation-1:1,3',
    granted: false,
    retryAt: DAY + policy.rollingWindowMs + 10
  });

	const replay = permitServiceQuotaState(denied.state, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, DAY + 3);
  assert.equal(replay.permit.granted, true);
  assert.equal(replay.state.rollingPermits.length, 2);

  const afterWindow = permitServiceQuotaState(
    replay.state,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,3' },
    DAY + policy.rollingWindowMs + 1
  );
  assert.equal(afterWindow.permit.granted, true);
  assert.equal(afterWindow.state.rollingPermits.length, 1);
});

test('release is once-only and cannot run after the matching permit', () => {
  const reserved = reserveServiceQuotaState(
    createServiceQuotaState('pokeworld', policy, DAY),
    { reservationId: 'reservation-1', count: 2, policy },
    DAY
  ).state;
	const firstRelease = releaseServiceQuotaState(reserved, { reservationId: 'reservation-1', releaseId: 'reservation-1:1,1' }, DAY + 1);
  assert.equal(firstRelease.release.applied, true);
  assert.equal(firstRelease.state.dailyUsed, 1);

	const replay = releaseServiceQuotaState(firstRelease.state, { reservationId: 'reservation-1', releaseId: 'reservation-1:1,1' }, DAY + 2);
  assert.equal(replay.release.applied, false);
  assert.equal(replay.state.dailyUsed, 1);

	const permitted = permitServiceQuotaState(replay.state, { reservationId: 'reservation-1', permitId: 'reservation-1:1,2' }, DAY + 3).state;
	expectQuotaError(
		() => releaseServiceQuotaState(permitted, { reservationId: 'reservation-1', releaseId: 'reservation-1:1,2' }, DAY + 4),
		'QUOTA_RELEASE_CONFLICT'
	);
});

test('permit and release children cannot exceed their reservation cardinality', () => {
	const oneSlot = reserveServiceQuotaState(
		createServiceQuotaState('pokeworld', policy, DAY),
		{ reservationId: 'one-slot', count: 1, policy },
		DAY
  ).state;
	const permitted = permitServiceQuotaState(oneSlot, { reservationId: 'one-slot', permitId: 'one-slot:permit' }, DAY + 1).state;
  expectQuotaError(
		() => releaseServiceQuotaState(permitted, { reservationId: 'one-slot', releaseId: 'one-slot:different-release' }, DAY + 2),
    'QUOTA_RELEASE_CONFLICT'
  );

	const released = releaseServiceQuotaState(oneSlot, { reservationId: 'one-slot', releaseId: 'one-slot:release' }, DAY + 1).state;
	expectQuotaError(
		() => permitServiceQuotaState(released, { reservationId: 'one-slot', permitId: 'one-slot:different-permit' }, DAY + 2),
		'QUOTA_PERMIT_CONFLICT'
	);

	const twoSlots = reserveServiceQuotaState(
		createServiceQuotaState('pokeworld', policy, DAY),
		{ reservationId: 'two-slots', count: 2, policy },
		DAY
	).state;
	const first = permitServiceQuotaState(twoSlots, { reservationId: 'two-slots', permitId: 'two-slots:permit' }, DAY + 1).state;
	const second = releaseServiceQuotaState(first, { reservationId: 'two-slots', releaseId: 'two-slots:release' }, DAY + 2).state;
	assert.equal(second.dailyUsed, 1);
	assert.equal(isConsistentServiceQuotaState(second), true);
	expectQuotaError(
		() => permitServiceQuotaState(second, { reservationId: 'two-slots', permitId: 'two-slots:third-child' }, DAY + 3),
		'QUOTA_PERMIT_CONFLICT'
	);
});

test('UTC rollover only moves forward while retaining still-live rolling permits', () => {
  const beforeMidnight = Date.parse('2026-07-19T23:59:59.000Z');
  const longWindowPolicy = { dailyLimit: 3, rollingLimit: 2, rollingWindowMs: 120_000 };
  const reserved = reserveServiceQuotaState(
    createServiceQuotaState('pokeworld', longWindowPolicy, beforeMidnight),
    { reservationId: 'reservation-1', count: 1, policy: longWindowPolicy },
    beforeMidnight
  ).state;
	const permitted = permitServiceQuotaState(reserved, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, beforeMidnight).state;

  const nextDay = normalizeServiceQuotaState(permitted, beforeMidnight + 2_000);
  assert.equal(nextDay.dayKey, '2026-07-20');
  assert.equal(nextDay.dailyUsed, 0);
  assert.deepEqual(nextDay.reservations, []);
  assert.deepEqual(nextDay.permitIds, []);
  assert.equal(nextDay.rollingPermits.length, 1);
	assert.equal(isConsistentServiceQuotaState(nextDay), true);

	const replay = permitServiceQuotaState(nextDay, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, beforeMidnight + 2_001);
	assert.equal(replay.permit.granted, true);
	assert.deepEqual(replay.state.reservations, []);
	expectQuotaError(
		() => permitServiceQuotaState(nextDay, { reservationId: 'reservation-1', permitId: 'reservation-1:new' }, beforeMidnight + 2_001),
		'QUOTA_RESERVATION_EXPIRED'
	);

  const delayedOldClock = normalizeServiceQuotaState(nextDay, beforeMidnight);
  assert.equal(delayedOldClock.dayKey, '2026-07-20');
  assert.equal(delayedOldClock.dailyUsed, 0);
});

test('reset compacts daily histories while retaining active rolling permits', () => {
  const reserved = reserveServiceQuotaState(
    createServiceQuotaState('pokeworld', policy, DAY),
    { reservationId: 'reservation-1', count: 2, policy },
    DAY
  ).state;
	const permitted = permitServiceQuotaState(reserved, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, DAY + 1).state;
  const reset = resetServiceQuotaState(permitted, DAY + 2);
  assert.equal(reset.dailyUsed, 0);
	assert.deepEqual(reset.reservations, []);
	assert.deepEqual(reset.permitIds, []);
	assert.deepEqual(reset.releasedIds, []);
  assert.equal(reset.rollingPermits.length, 1);
	assert.equal(isConsistentServiceQuotaState(reset), true);
	expectQuotaError(
		() => releaseServiceQuotaState(reset, { reservationId: 'reservation-1', releaseId: 'reservation-1:1,2' }, DAY + 3),
		'QUOTA_RESERVATION_EXPIRED'
  );
	const rollingReplay = permitServiceQuotaState(reset, { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' }, DAY + 3);
	assert.equal(rollingReplay.permit.granted, true);
  assert.deepEqual(serviceQuotaStatus(reset), {
    key: 'pokeworld',
    policy,
    dayKey: '2026-07-19',
    dailyUsed: 0,
    dailyRemaining: 3,
    rollingUsed: 1,
    rollingRemaining: 1,
    rollingResetAt: DAY + 1 + policy.rollingWindowMs
  });
});

test('released history may exceed the policy limit and is bounded by an independent hard cap', () => {
	let state = createServiceQuotaState('pokeworld', policy, DAY);
	for (let index = 0; index < policy.dailyLimit + 2; index += 1) {
		const reservationId = `cycle-${index}`;
		state = reserveServiceQuotaState(state, { reservationId, count: 1, policy }, DAY + index * 2).state;
		state = releaseServiceQuotaState(state, { reservationId, releaseId: `${reservationId}:release` }, DAY + index * 2 + 1).state;
	}
	assert.equal(state.dailyUsed, 0);
	assert.equal(state.reservations.length, policy.dailyLimit + 2);
	assert.equal(state.releasedIds.length, policy.dailyLimit + 2);
	assert.equal(isConsistentServiceQuotaState(state), true);

	const maxPolicy = {
		dailyLimit: 10_000,
		rollingLimit: 1,
		rollingWindowMs: 5_000
	};
	const historyFull = {
		...createServiceQuotaState('pokeworld', maxPolicy, DAY),
		dailyUsed: 1,
		reservations: [
			{
				id: 'historical',
				count: SERVICE_QUOTA_MAX_CHILD_HISTORY,
				releasedCount: SERVICE_QUOTA_MAX_CHILD_HISTORY
			},
			{ id: 'active', count: 1, releasedCount: 0 }
		],
		releasedIds: Array.from({ length: SERVICE_QUOTA_MAX_CHILD_HISTORY }, (_, index) => `historical:${index}`)
	};
	assert.equal(isConsistentServiceQuotaState(historyFull), true);
	expectQuotaError(
		() => releaseServiceQuotaState(historyFull, { reservationId: 'active', releaseId: 'active:release' }, DAY + 1),
		'QUOTA_HISTORY_LIMIT'
	);

	const compacted = resetServiceQuotaState(historyFull, DAY + 2);
	assert.deepEqual(compacted.reservations, []);
	assert.deepEqual(compacted.releasedIds, []);
	assert.equal(isConsistentServiceQuotaState(compacted), true);
});

test('persisted consistency rejects orphaned and over-cardinality children', () => {
	const reserved = reserveServiceQuotaState(
		createServiceQuotaState('pokeworld', policy, DAY),
		{ reservationId: 'reservation-1', count: 1, policy },
		DAY
	).state;
	assert.equal(
		isConsistentServiceQuotaState({
			...reserved,
			permitIds: ['reservation-1:first', 'reservation-1:second']
		}),
		false
	);
	assert.equal(
		isConsistentServiceQuotaState({
			...reserved,
			permitIds: ['different-reservation:first']
		}),
		false
	);
	assert.equal(
		isConsistentServiceQuotaState({
			...reserved,
			dailyUsed: 3,
			reservations: [
				{ id: 'reservation-1', count: 1, releasedCount: 0 },
				{ id: 'reservation-1-other', count: 1, releasedCount: 0 },
				{ id: 'reservation-1:child', count: 1, releasedCount: 0 }
			]
		}),
		false,
		'namespace overlap must be detected even when lexical neighbors interleave'
	);
});
