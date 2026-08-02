import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { admitAppAndUserStorage, remainingStorageBytes, storageUsage, storedByteCount } from './appStorageCore.ts';

test('stored quota fields keep zero, reject invalid values, and clamp remaining bytes', () => {
  assert.equal(storedByteCount(0, 50), 0);
  assert.equal(storedByteCount(42, 50), 42);
  assert.equal(storedByteCount(-1, 50), 50);
  assert.equal(storedByteCount(1.5, 50), 50);
  assert.equal(storedByteCount('42', 50), 50);
  assert.deepEqual(storageUsage(75, 100, 999), { usedBytes: 75, allowanceBytes: 100 });
  assert.equal(remainingStorageBytes({ usedBytes: 75, allowanceBytes: 100 }), 25);
  assert.equal(remainingStorageBytes({ usedBytes: 125, allowanceBytes: 100 }), 0);
});

test('whole-app exhaustion never touches the app-user ledger', async () => {
  let userReservations = 0;
  let appRefunds = 0;
  const result = await admitAppAndUserStorage({
    reserveApp: async () => null,
    reserveUser: async () => {
      userReservations += 1;
      return { usedBytes: 1, allowanceBytes: 1 };
    },
    refundApp: async () => {
      appRefunds += 1;
    }
  });

  assert.deepEqual(result, { ok: false, exhausted: 'app' });
  assert.equal(userReservations, 0);
  assert.equal(appRefunds, 0);
});

test('app-user exhaustion compensates the whole-app reservation exactly once', async () => {
  let appUsed = 10;
  const result = await admitAppAndUserStorage({
    reserveApp: async () => {
      appUsed += 5;
      return { usedBytes: appUsed, allowanceBytes: 100, userAllowanceBytes: 4 };
    },
    reserveUser: async () => null,
    refundApp: async () => {
      appUsed -= 5;
    }
  });

  assert.deepEqual(result, { ok: false, exhausted: 'user' });
  assert.equal(appUsed, 10);
});

test('a user-ledger error fails closed and compensates the app reservation', async () => {
  let appUsed = 0;
  await assert.rejects(
    admitAppAndUserStorage({
      reserveApp: async () => {
        appUsed += 8;
        return { usedBytes: appUsed, allowanceBytes: 100, userAllowanceBytes: 50 };
      },
      reserveUser: async () => {
        throw new Error('ledger offline');
      },
      refundApp: async () => {
        appUsed -= 8;
      }
    }),
    /ledger offline/
  );
  assert.equal(appUsed, 0);
});

test('concurrent users never overshoot either allowance', async () => {
  let appUsed = 0;
  const userUsed = new Map<string, number>();
  const reserve = (userId: string) =>
    admitAppAndUserStorage({
      reserveApp: async () => {
        if (appUsed + 10 > 50) return null;
        appUsed += 10;
        return { usedBytes: appUsed, allowanceBytes: 50, userAllowanceBytes: 20 };
      },
      reserveUser: async (allowanceBytes) => {
        const used = userUsed.get(userId) || 0;
        if (used + 10 > allowanceBytes) return null;
        userUsed.set(userId, used + 10);
        return { usedBytes: used + 10, allowanceBytes };
      },
      refundApp: async () => {
        appUsed -= 10;
      }
    });

  const results = await Promise.all([
    reserve('alice'),
    reserve('alice'),
    reserve('alice'),
    reserve('bob'),
    reserve('bob'),
    reserve('bob'),
    reserve('carol')
  ]);
  const admitted = results.filter((result) => result.ok).length;

  // One contender may conservatively observe an aggregate reservation that a
  // different user's refusal is about to refund. Retrying can use that space;
  // the invariant here is that neither standing ledger ever overshoots.
  assert.equal(admitted, 4);
  assert.equal(appUsed, 40);
  assert.equal(userUsed.get('alice'), 20);
  assert.equal(userUsed.get('bob'), 20);
  assert.equal(userUsed.get('carol'), undefined);
  assert.ok(appUsed <= 50);
  assert.ok([...userUsed.values()].every((used) => used <= 20));
});
