import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SUBSCRIPTION_TIER,
  QUOTA_OVERRIDE_BOUNDS,
  QUOTA_OVERRIDE_FIELDS,
  SUBSCRIPTION_TIER_CATALOG,
  computeTierDiscounts,
  currencyMinorUnitFactor,
  isKnownSubscriptionTier,
  resolveTierQuotas,
  sanitizeQuotaOverrides,
  subscriptionTierById,
  speedTestsPerHour,
  speedTestAllowanceLabel,
  sanitizeTierQuotas
} from './tierCatalog.ts';

test('speed-test comparison and enforcement agree for current and historical tiers', () => {
  for (const [id, expected] of [
    ['free', 4],
    ['plus', 20],
    ['pro', null],
    ['payg', null],
    ['custom', 4]
  ] as const) {
    assert.equal(speedTestsPerHour(id, {}), expected);
    assert.equal(speedTestsPerHour(id, subscriptionTierById(id).quotas), expected);
  }
  assert.equal(speedTestAllowanceLabel(null), 'Unlimited');
  assert.equal(speedTestAllowanceLabel(20), '20 tests / hour');
  assert.equal(speedTestsPerHour('pro', { speedTestsPerHour: 0 }), 0);
  assert.equal(speedTestsPerHour('free', { speedTestsPerHour: null }), null);
  assert.equal(speedTestsPerHour('pro', { speedTestsPerHour: NaN }), 0);
  assert.equal(sanitizeTierQuotas({ maxApps: 1, maxPats: 2, appStorageBytes: 3, userStorageBytes: 4 }).ok, true);
});

test('catalog: four tiers, free is the default and mirrors the legacy caps', () => {
  assert.deepEqual(
    SUBSCRIPTION_TIER_CATALOG.map((tier) => tier.id),
    ['free', 'plus', 'pro', 'payg']
  );
  assert.equal(DEFAULT_SUBSCRIPTION_TIER, 'free');
  const free = subscriptionTierById('free');
  assert.equal(free.quotas.appStorageBytes, 5 * 1024 * 1024 * 1024);
  assert.equal(subscriptionTierById('plus').quotas.appStorageBytes, 25 * 1024 * 1024 * 1024);
  assert.equal(subscriptionTierById('pro').quotas.appStorageBytes, 100 * 1024 * 1024 * 1024);
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

test('computeTierDiscounts: resolves all six annualized renewal comparisons', () => {
  const discounts = computeTierDiscounts({ daily: 100, weekly: 600, monthly: 2500, yearly: 24000 });
  assert.deepEqual(discounts, {
    weeklyFromDaily: 14.52,
    monthlyFromDaily: 17.81,
    monthlyFromWeekly: 3.85,
    yearlyFromDaily: 34.25,
    yearlyFromWeekly: 23.08,
    yearlyFromMonthly: 20
  });
});

test('computeTierDiscounts: custom values win while blank/zero comparisons stay unavailable', () => {
  const discounts = computeTierDiscounts({ daily: 0, weekly: 800, monthly: 2500, yearly: null }, { monthlyFromDaily: 42.5 });
  assert.equal(discounts.weeklyFromDaily, null);
  assert.equal(discounts.monthlyFromDaily, 42.5);
  assert.equal(discounts.monthlyFromWeekly, 27.88);
  assert.equal(discounts.yearlyFromDaily, null);
  assert.equal(discounts.yearlyFromWeekly, null);
  assert.equal(discounts.yearlyFromMonthly, null);
});

test('currencyMinorUnitFactor follows zero-, two-, and three-decimal currencies', () => {
  assert.equal(currencyMinorUnitFactor('JPY'), 1);
  assert.equal(currencyMinorUnitFactor('USD'), 100);
  assert.equal(currencyMinorUnitFactor('KWD'), 1000);
});
