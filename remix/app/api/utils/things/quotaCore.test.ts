import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  assertServiceQuotaChildId,
  createServiceQuotaState,
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
  assert.equal(
    assertServiceQuotaChildId('permitId', 'reservation-1', 'reservation-1:-946647,488524'),
    'reservation-1:-946647,488524'
  );
  expectQuotaError(() => parseServiceQuotaKey('../escape'), 'INVALID_REQUEST');
  expectQuotaError(
    () => parseServiceQuotaPolicy({ dailyLimit: 0, rollingLimit: 2, rollingWindowMs: 5_000 }),
    'INVALID_REQUEST'
  );
  expectQuotaError(
    () => assertServiceQuotaChildId('permitId', 'reservation-1', 'reservation-2:1,1'),
    'QUOTA_PERMIT_CONFLICT'
  );
});

test('reserve is idempotent, rejects conflicting counts, and stops at the daily cap', () => {
  const initial = createServiceQuotaState('pokeworld', policy, DAY);
  const first = reserveServiceQuotaState(
    initial,
    { reservationId: 'reservation-1', count: 2, policy },
    DAY
  );
  const replay = reserveServiceQuotaState(
    first.state,
    { reservationId: 'reservation-1', count: 2, policy },
    DAY + 1
  );
  assert.equal(replay.state.dailyUsed, 2);
  assert.equal(replay.state.reservations.length, 1);

  expectQuotaError(
    () =>
      reserveServiceQuotaState(
        replay.state,
        { reservationId: 'reservation-1', count: 1, policy },
        DAY + 2
      ),
    'QUOTA_RESERVATION_CONFLICT'
  );
  expectQuotaError(
    () =>
      reserveServiceQuotaState(
        replay.state,
        { reservationId: 'reservation-2', count: 2, policy },
        DAY + 2
      ),
    'QUOTA_DAILY_LIMIT'
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
  const first = permitServiceQuotaState(
    reserved,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' },
    DAY
  );
  const second = permitServiceQuotaState(
    first.state,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,2' },
    DAY + 1
  );
  const denied = permitServiceQuotaState(
    second.state,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,3' },
    DAY + 2
  );
  assert.deepEqual(denied.permit, {
    permitId: 'reservation-1:1,3',
    granted: false,
    retryAt: DAY + policy.rollingWindowMs + 10
  });

  const replay = permitServiceQuotaState(
    denied.state,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' },
    DAY + 3
  );
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
  const firstRelease = releaseServiceQuotaState(
    reserved,
    { reservationId: 'reservation-1', releaseId: 'reservation-1:1,1' },
    DAY + 1
  );
  assert.equal(firstRelease.release.applied, true);
  assert.equal(firstRelease.state.dailyUsed, 1);

  const replay = releaseServiceQuotaState(
    firstRelease.state,
    { reservationId: 'reservation-1', releaseId: 'reservation-1:1,1' },
    DAY + 2
  );
  assert.equal(replay.release.applied, false);
  assert.equal(replay.state.dailyUsed, 1);

  const permitted = permitServiceQuotaState(
    replay.state,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,2' },
    DAY + 3
  ).state;
  expectQuotaError(
    () =>
      releaseServiceQuotaState(
        permitted,
        { reservationId: 'reservation-1', releaseId: 'reservation-1:1,2' },
        DAY + 4
      ),
    'QUOTA_RELEASE_CONFLICT'
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
  const permitted = permitServiceQuotaState(
    reserved,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' },
    beforeMidnight
  ).state;

  const nextDay = normalizeServiceQuotaState(permitted, beforeMidnight + 2_000);
  assert.equal(nextDay.dayKey, '2026-07-20');
  assert.equal(nextDay.dailyUsed, 0);
  assert.deepEqual(nextDay.reservations, []);
  assert.deepEqual(nextDay.permitIds, []);
  assert.equal(nextDay.rollingPermits.length, 1);

  const delayedOldClock = normalizeServiceQuotaState(nextDay, beforeMidnight);
  assert.equal(delayedOldClock.dayKey, '2026-07-20');
  assert.equal(delayedOldClock.dailyUsed, 0);
});

test('reset clears daily usage without cancelling active reservation or permit identity', () => {
  const reserved = reserveServiceQuotaState(
    createServiceQuotaState('pokeworld', policy, DAY),
    { reservationId: 'reservation-1', count: 2, policy },
    DAY
  ).state;
  const permitted = permitServiceQuotaState(
    reserved,
    { reservationId: 'reservation-1', permitId: 'reservation-1:1,1' },
    DAY + 1
  ).state;
  const reset = resetServiceQuotaState(permitted, DAY + 2);
  assert.equal(reset.dailyUsed, 0);
  assert.equal(reset.reservations[0]?.id, 'reservation-1');
  assert.equal(reset.reservations[0]?.count, 0);
  assert.deepEqual(reset.permitIds, ['reservation-1:1,1']);
  assert.equal(reset.rollingPermits.length, 1);
  const lateRelease = releaseServiceQuotaState(
    reset,
    { reservationId: 'reservation-1', releaseId: 'reservation-1:1,2' },
    DAY + 3
  );
  assert.deepEqual(lateRelease.release, {
    releaseId: 'reservation-1:1,2',
    released: true,
    applied: false
  });
  assert.equal(lateRelease.state.dailyUsed, 0);
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
