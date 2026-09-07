import assert from 'node:assert/strict';
import test from 'node:test';

import {
  billingForProvider,
  evaluateLopuAccess,
  LOPU_GUEST_CODE,
  LOPU_NO_CREDITS_CODE,
  LOPU_NO_CREDITS_ERROR,
  LOPU_UNVERIFIED_CODE,
  LOPU_UNVERIFIED_ERROR,
  lopuAccessRefusalBody,
  lopuUserVerified,
  resolveLopuBilling
} from './accessCore';
import { createAssertLopuAccess, lopuAccessResponse } from './access';

// The gate matrix (design note §1): guest / unverified / verified / admin ×
// billing × balance, the exact codes and copy, and the async gate's account
// creation — no Mongo, the settings and the account are injected.

const locked = { requireVerification: true, allowByoUnverified: false };
const byoOpen = { requireVerification: true, allowByoUnverified: true };
const open = { requireVerification: false, allowByoUnverified: false };

const guest = { id: 'g', temporary: true };
const unverified = { id: 'u' };
const verified = { id: 'v', lopuVerified: true };
const admin = { id: 'a', isAdmin: true };

test('the matrix: who may run a turn under which billing', () => {
  // guests are refused everywhere, even with verification off
  for (const billing of ['thingtime', 'byo', 'free'] as const) {
    for (const settings of [locked, byoOpen, open]) {
      const verdict = evaluateLopuAccess(guest, { billing, settings, balanceMicros: 5 });
      assert.equal(verdict.ok, false);
      assert.equal((verdict as any).status, 403);
      assert.equal((verdict as any).code, LOPU_GUEST_CODE);
    }
  }
  assert.equal((evaluateLopuAccess(null, { billing: 'free', settings: open }) as any).code, LOPU_GUEST_CODE);

  // unverified: locked out unless BYO is allowed for unverified accounts
  assert.deepEqual(evaluateLopuAccess(unverified, { billing: 'thingtime', settings: locked, balanceMicros: 5 }), {
    ok: false,
    status: 403,
    code: LOPU_UNVERIFIED_CODE,
    error: LOPU_UNVERIFIED_ERROR
  });
  assert.equal((evaluateLopuAccess(unverified, { billing: 'free', settings: locked }) as any).code, LOPU_UNVERIFIED_CODE);
  assert.equal((evaluateLopuAccess(unverified, { billing: 'byo', settings: locked }) as any).code, LOPU_UNVERIFIED_CODE);
  assert.deepEqual(evaluateLopuAccess(unverified, { billing: 'byo', settings: byoOpen }), { ok: true });
  assert.equal((evaluateLopuAccess(unverified, { billing: 'thingtime', settings: byoOpen, balanceMicros: 5 }) as any).code, LOPU_UNVERIFIED_CODE);
  // verification off: an unverified account passes like a verified one
  assert.deepEqual(evaluateLopuAccess(unverified, { billing: 'thingtime', settings: open, balanceMicros: 5 }), { ok: true });

  // verified and admin pass the verification rule; admins are verified by definition
  assert.deepEqual(evaluateLopuAccess(verified, { billing: 'thingtime', settings: locked, balanceMicros: 5 }), { ok: true });
  assert.deepEqual(evaluateLopuAccess(admin, { billing: 'thingtime', settings: locked, balanceMicros: 5 }), { ok: true });
  assert.equal(lopuUserVerified(admin), true);
  assert.equal(lopuUserVerified(verified), true);
  assert.equal(lopuUserVerified(unverified), false);
  assert.equal(lopuUserVerified({ lopuVerified: 'true' as any }), false);
  assert.equal(lopuUserVerified(null), false);

  // credits: thingtime billing needs a positive balance — everyone, admins included
  for (const user of [verified, admin]) {
    assert.deepEqual(evaluateLopuAccess(user, { billing: 'thingtime', settings: locked, balanceMicros: 0 }), {
      ok: false,
      status: 402,
      code: LOPU_NO_CREDITS_CODE,
      error: LOPU_NO_CREDITS_ERROR,
      balanceMicros: 0
    });
    assert.equal((evaluateLopuAccess(user, { billing: 'thingtime', settings: locked, balanceMicros: -250_000 }) as any).balanceMicros, -250_000);
    assert.equal((evaluateLopuAccess(user, { billing: 'thingtime', settings: locked }) as any).code, LOPU_NO_CREDITS_CODE);
    assert.deepEqual(evaluateLopuAccess(user, { billing: 'thingtime', settings: locked, balanceMicros: 1 }), { ok: true });
    // never for byo / free
    assert.deepEqual(evaluateLopuAccess(user, { billing: 'byo', settings: locked, balanceMicros: 0 }), { ok: true });
    assert.deepEqual(evaluateLopuAccess(user, { billing: 'free', settings: locked, balanceMicros: -1 }), { ok: true });
  }
  // the verification refusal wins over the credits refusal
  assert.equal((evaluateLopuAccess(unverified, { billing: 'thingtime', settings: locked, balanceMicros: 0 }) as any).code, LOPU_UNVERIFIED_CODE);
});

test('the refusal body carries the code (and the balance on a 402)', async () => {
  const unverifiedBody = lopuAccessRefusalBody(evaluateLopuAccess(unverified, { billing: 'thingtime', settings: locked, balanceMicros: 1 }) as any);
  assert.deepEqual(unverifiedBody, { ok: false, error: LOPU_UNVERIFIED_ERROR, code: LOPU_UNVERIFIED_CODE });
  const brokeBody = lopuAccessRefusalBody(evaluateLopuAccess(verified, { billing: 'thingtime', settings: locked, balanceMicros: -7 }) as any);
  assert.deepEqual(brokeBody, { ok: false, error: LOPU_NO_CREDITS_ERROR, code: LOPU_NO_CREDITS_CODE, balanceMicros: -7 });
  const response = lopuAccessResponse(evaluateLopuAccess(verified, { billing: 'thingtime', settings: locked, balanceMicros: 0 }) as any);
  assert.equal(response.status, 402);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: false, error: LOPU_NO_CREDITS_ERROR, code: LOPU_NO_CREDITS_CODE, balanceMicros: 0 });
  // the copy has no gender for Lopu
  assert.doesNotMatch(`${LOPU_UNVERIFIED_ERROR} ${LOPU_NO_CREDITS_ERROR}`, /\b(she|her|he|him|his)\b/i);
});

test('billing resolution: vault is byo, the canned fallback is free, server keys and the test provider bill credits', () => {
  assert.equal(billingForProvider('vault'), 'byo');
  assert.equal(billingForProvider('fallback'), 'free');
  assert.equal(billingForProvider('claude'), 'thingtime');
  assert.equal(billingForProvider('openai'), 'thingtime');
  assert.equal(billingForProvider('test'), 'thingtime');
  assert.equal(billingForProvider(null), 'thingtime');
  assert.equal(resolveLopuBilling({ vault: true, mode: 'auto', configured: false }), 'byo');
  assert.equal(resolveLopuBilling({ vault: false, mode: 'test', configured: false }), 'thingtime');
  assert.equal(resolveLopuBilling({ vault: false, mode: 'auto', configured: true }), 'thingtime');
  assert.equal(resolveLopuBilling({ vault: false, mode: 'claude', configured: true }), 'thingtime');
  assert.equal(resolveLopuBilling({ vault: false, mode: 'auto', configured: false }), 'free');
});

test('the async gate reads the settings, creates the account lazily for thingtime billing and never for a refused caller', async () => {
  let settings = { ...locked, starterCredits: 0, lowBalanceWarningCredits: 1 };
  const ensured: string[] = [];
  let balance = 0;
  const gate = createAssertLopuAccess({
    getSettings: async () => settings,
    ensureAccount: async (userId) => {
      ensured.push(userId);
      return { id: `acct-${userId}`, userId, crystal: { balanceMicros: balance } as any, createdAt: null, updatedAt: null };
    }
  });

  // an unverified caller is refused before any account exists
  const refused = await gate(unverified, { billing: 'thingtime' });
  assert.equal((refused as any).code, LOPU_UNVERIFIED_CODE);
  assert.deepEqual(ensured, []);
  // a guest too
  assert.equal((await gate(guest, { billing: 'byo' }) as any).code, LOPU_GUEST_CODE);
  assert.deepEqual(ensured, []);

  // a verified caller on thingtime billing gets an account and, with no
  // balance, a 402 that names the balance the gate saw
  const broke = await gate(verified, { billing: 'thingtime' });
  assert.deepEqual(broke, { ok: false, status: 402, code: LOPU_NO_CREDITS_CODE, error: LOPU_NO_CREDITS_ERROR, balanceMicros: 0 });
  assert.deepEqual(ensured, ['v']);

  balance = 2_000_000;
  const granted = await gate(verified, { billing: 'thingtime' });
  assert.equal(granted.ok, true);
  assert.equal((granted as any).billing, 'thingtime');
  assert.equal((granted as any).verified, true);
  assert.equal((granted as any).account.crystal.balanceMicros, 2_000_000);
  assert.deepEqual((granted as any).settings, settings);

  // byo / free never touch the account
  ensured.length = 0;
  assert.equal((await gate(verified, { billing: 'byo' })).ok, true);
  assert.equal((await gate(verified, { billing: 'free' })).ok, true);
  assert.deepEqual(ensured, []);
  assert.equal((await gate(verified, { billing: 'byo' }) as any).account, null);

  // the settings are read fresh on every call: unlocking BYO for unverified
  // accounts takes effect at once, and turning verification off opens Lopu
  settings = { ...byoOpen, starterCredits: 0, lowBalanceWarningCredits: 1 };
  assert.equal((await gate(unverified, { billing: 'byo' })).ok, true);
  assert.equal((await gate(unverified, { billing: 'thingtime' }) as any).code, LOPU_UNVERIFIED_CODE);
  settings = { ...open, starterCredits: 0, lowBalanceWarningCredits: 1 };
  assert.equal((await gate(unverified, { billing: 'thingtime' })).ok, true);
  assert.equal((await gate(unverified, { billing: 'thingtime' }) as any).verified, false);
});
