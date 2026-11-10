import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createLopuAccessStore, DEFAULT_LOPU_ACCESS_SETTINGS, LOPU_ACCESS_KEY, normalizeLopuAccessSettings, validateLopuAccessSettings } from './lopuAccess.ts';

// The Thingtime.LopuAccess singleton (design note §1): the locked-by-default
// posture, forgiving reads, strict partial writes, and the same durable-read
// contract as the chat defaults store.

test('the hard default locks Lopu and grants nothing', () => {
  assert.equal(LOPU_ACCESS_KEY, 'Thingtime.LopuAccess');
  assert.deepEqual(DEFAULT_LOPU_ACCESS_SETTINGS, { requireVerification: true, allowByoUnverified: false, starterCredits: 0, lowBalanceWarningCredits: 1 });
});

test('normalize reads forgivingly: missing, corrupt and out-of-range values fall back per field', () => {
  assert.deepEqual(normalizeLopuAccessSettings(undefined), DEFAULT_LOPU_ACCESS_SETTINGS);
  assert.deepEqual(normalizeLopuAccessSettings('junk'), DEFAULT_LOPU_ACCESS_SETTINGS);
  assert.deepEqual(normalizeLopuAccessSettings({ requireVerification: false, allowByoUnverified: true, starterCredits: 2.5, lowBalanceWarningCredits: 0.25, extra: 1 }), {
    requireVerification: false,
    allowByoUnverified: true,
    starterCredits: 2.5,
    lowBalanceWarningCredits: 0.25
  });
  // booleans must be real booleans; numbers accept numeric strings, refuse
  // negatives / NaN, and clamp to the ceiling
  assert.deepEqual(normalizeLopuAccessSettings({ requireVerification: 'false', allowByoUnverified: 1, starterCredits: '3', lowBalanceWarningCredits: -4 }), {
    requireVerification: true,
    allowByoUnverified: false,
    starterCredits: 3,
    lowBalanceWarningCredits: 1
  });
  assert.equal(normalizeLopuAccessSettings({ starterCredits: 999_999 }).starterCredits, 1000);
  assert.equal(normalizeLopuAccessSettings({ starterCredits: 0.12345678 }).starterCredits, 0.123457);
});

test('validate is strict and accepts a partial patch merged over the current settings', () => {
  const current = { requireVerification: true, allowByoUnverified: false, starterCredits: 0, lowBalanceWarningCredits: 1 };
  const patched = validateLopuAccessSettings({ allowByoUnverified: true }, current);
  assert.deepEqual(patched, { ok: true, settings: { ...current, allowByoUnverified: true } });
  const full = validateLopuAccessSettings({ requireVerification: false, allowByoUnverified: true, starterCredits: '5', lowBalanceWarningCredits: 2 }, current);
  assert.deepEqual(full, { ok: true, settings: { requireVerification: false, allowByoUnverified: true, starterCredits: 5, lowBalanceWarningCredits: 2 } });
  for (const [value, needle] of [
    [null, 'object'],
    [[], 'object'],
    [{ requireVerification: 'yes' }, 'requireVerification must be true or false'],
    [{ allowByoUnverified: 0 }, 'allowByoUnverified must be true or false'],
    [{ starterCredits: -1 }, 'starterCredits'],
    [{ starterCredits: 1001 }, 'starterCredits'],
    [{ starterCredits: 'lots' }, 'starterCredits'],
    [{ lowBalanceWarningCredits: Number.NaN }, 'lowBalanceWarningCredits'],
    [{ bogus: true }, 'Unknown Lopu access setting']
  ] as const) {
    const result = validateLopuAccessSettings(value, current);
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.match((result as { error: string }).error, new RegExp(needle));
  }
});

test('the store reads the durable singleton on every call and only serves last-known-good on a read failure', async () => {
  let stored: unknown = undefined;
  let reads = 0;
  let failing = false;
  const writes: Array<{ settings: unknown; updatedBy: string }> = [];
  const store = createLopuAccessStore({
    readStoredSettings: async () => {
      reads += 1;
      if (failing) throw new Error('mongo down');
      return stored;
    },
    writeStoredSettings: async (settings: unknown, updatedBy: string) => {
      writes.push({ settings, updatedBy });
      stored = settings;
    }
  });

  // cold: the hard default (locked)
  assert.deepEqual(await store.getSettings(), DEFAULT_LOPU_ACCESS_SETTINGS);
  // an external save is visible on the very next read (no TTL)
  stored = { requireVerification: false, allowByoUnverified: true, starterCredits: 1, lowBalanceWarningCredits: 0.5 };
  assert.deepEqual(await store.getSettings(), stored);
  assert.equal(reads, 2);
  // a partial save merges over the stored value, validates, and persists with the actor
  const saved = await store.setSettings({ starterCredits: 3 }, 'admin-1');
  assert.deepEqual(saved, { requireVerification: false, allowByoUnverified: true, starterCredits: 3, lowBalanceWarningCredits: 0.5 });
  assert.deepEqual(writes, [{ settings: saved, updatedBy: 'admin-1' }]);
  await assert.rejects(store.setSettings({ starterCredits: -3 }, 'admin-1'), TypeError);
  // an outage serves the last-known-good value, never a fresh guess
  failing = true;
  assert.deepEqual(await store.getSettings(), saved);
  // a cold store in an outage serves the locked default
  const cold = createLopuAccessStore({
    readStoredSettings: async () => {
      throw new Error('mongo down');
    },
    writeStoredSettings: async () => {}
  });
  assert.deepEqual(await cold.getSettings(), DEFAULT_LOPU_ACCESS_SETTINGS);
  // returned objects are copies
  const copy = await store.getSettings();
  copy.starterCredits = 999;
  assert.equal((await store.getSettings()).starterCredits, 3);
});
