import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SUBSCRIPTION_TIER,
  QUOTA_OVERRIDE_BOUNDS,
  QUOTA_OVERRIDE_FIELDS,
  SUBSCRIPTION_TIER_CATALOG,
  isKnownSubscriptionTier,
  resolveTierQuotas,
  sanitizeQuotaOverrides,
  subscriptionTierById
} from './tierCatalog.ts';

test('catalog: four tiers, free is the default and mirrors the legacy caps', () => {
  assert.deepEqual(
    SUBSCRIPTION_TIER_CATALOG.map((tier) => tier.id),
    ['free', 'plus', 'pro', 'payg']
  );
  assert.equal(DEFAULT_SUBSCRIPTION_TIER, 'free');
  const free = subscriptionTierById('free');
  assert.equal(free.quotas.appStorageBytes, 50 * 1024 * 1024);
  assert.equal(free.quotas.maxApps, 20);
  assert.equal(free.quotas.maxPats, 200);
  assert.equal(free.metered, false);
});

test('catalog: payg is metered with no hard caps', () => {
  const payg = subscriptionTierById('payg');
  assert.equal(payg.metered, true);
  for (const field of QUOTA_OVERRIDE_FIELDS) {
    assert.equal(payg.quotas[field], null, `${field} must be unlimited on payg`);
  }
});

test('isKnownSubscriptionTier rejects unknown values', () => {
  assert.equal(isKnownSubscriptionTier('pro'), true);
  assert.equal(isKnownSubscriptionTier('gold'), false);
  assert.equal(isKnownSubscriptionTier(null), false);
});

test('sanitizeQuotaOverrides: null/undefined mean no overrides', () => {
  assert.deepEqual(sanitizeQuotaOverrides(undefined), { ok: true, overrides: null });
  assert.deepEqual(sanitizeQuotaOverrides(null), { ok: true, overrides: null });
  assert.deepEqual(sanitizeQuotaOverrides({}), { ok: true, overrides: null });
});

test('sanitizeQuotaOverrides: unknown fields fail loudly', () => {
  const result = sanitizeQuotaOverrides({ maxThings: 5 });
  assert.equal(result.ok, false);
  assert.match((result as { ok: false; error: string }).error, /Unknown quota field/);
});

test('sanitizeQuotaOverrides: clamps to bounds, floors decimals, keeps explicit null', () => {
  const result = sanitizeQuotaOverrides({
    appStorageBytes: -5,
    maxApps: 10.9,
    maxPats: 10 ** 12,
    userStorageBytes: null
  });
  assert.equal(result.ok, true);
  const overrides = (result as { ok: true; overrides: Record<string, number | null> }).overrides;
  assert.equal(overrides.appStorageBytes, 0);
  assert.equal(overrides.maxApps, 10);
  assert.equal(overrides.maxPats, QUOTA_OVERRIDE_BOUNDS.maxPats.max);
  assert.equal(overrides.userStorageBytes, null);
});

test('sanitizeQuotaOverrides: non-numeric values fail', () => {
  assert.equal(sanitizeQuotaOverrides({ maxApps: 'lots' }).ok, false);
  assert.equal(sanitizeQuotaOverrides([1, 2]).ok, false);
});

test('resolveTierQuotas: overrides win per-field, absent fields inherit', () => {
  const resolved = resolveTierQuotas('free', { appStorageBytes: 123, maxPats: null });
  assert.equal(resolved.appStorageBytes, 123);
  assert.equal(resolved.maxPats, null);
  assert.equal(resolved.maxApps, subscriptionTierById('free').quotas.maxApps);
  assert.equal(resolved.userStorageBytes, subscriptionTierById('free').quotas.userStorageBytes);
});

test('resolveTierQuotas: no overrides returns a copy of the tier quotas', () => {
  const resolved = resolveTierQuotas('pro');
  assert.deepEqual(resolved, subscriptionTierById('pro').quotas);
  assert.notEqual(resolved, subscriptionTierById('pro').quotas);
});
