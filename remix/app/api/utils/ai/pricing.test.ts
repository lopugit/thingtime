import assert from 'node:assert/strict';
import test from 'node:test';

import { AI_MODEL_CATALOG_IDS } from './modelsCore';
import {
  AI_MODEL_PRICING,
  creditsToMicros,
  formatCredits,
  getAiModelPricing,
  LOPU_TEST_MODEL_ID,
  MICROS_PER_CREDIT,
  microsToCredits,
  priceTurn,
  publicAiModelPricing,
  roundHalfUp
} from './pricing';

// Pure pricing coverage (design note §2): every catalog model has a price,
// the arithmetic is exact integer micros rounded half up, cache tokens bill
// when present, and the scripted test provider's synthetic usage prices
// against the `test-model` row.

test('every catalog model carries a price and the table has no stray ids', () => {
  for (const id of AI_MODEL_CATALOG_IDS) {
    const price = getAiModelPricing(id);
    assert.ok(price, `${id} has no price`);
    assert.ok(price!.inputPerM > 0 && price!.outputPerM > 0, `${id} price must be positive`);
    assert.equal(typeof price!.estimated, 'boolean', `${id} needs an estimated flag`);
  }
  for (const id of Object.keys(AI_MODEL_PRICING)) {
    assert.ok(id === LOPU_TEST_MODEL_ID || AI_MODEL_CATALOG_IDS.includes(id), `${id} is priced but not in the catalog`);
  }
  // the Anthropic rows are list prices (never estimated); cache rates follow
  // the documented multiples
  const opus = getAiModelPricing('claude-opus-5')!;
  assert.deepEqual(opus, { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5, cacheWritePerM: 6.25, estimated: false });
  assert.equal(getAiModelPricing('claude-sonnet-5')!.estimated, false);
  assert.equal(getAiModelPricing('claude-haiku-4-5')!.inputPerM, 1);
  // a row priced from its sibling says so
  assert.equal(getAiModelPricing('gpt-5.6-sol')!.estimated, true);
  assert.equal(getAiModelPricing('gpt-4o')!.estimated, false);
  // the test entry (design note §2)
  assert.equal(AI_MODEL_PRICING[LOPU_TEST_MODEL_ID].inputPerM, 1000);
  assert.equal(AI_MODEL_PRICING[LOPU_TEST_MODEL_ID].outputPerM, 2000);
});

test('getAiModelPricing returns copies and tolerates junk', () => {
  const price = getAiModelPricing(' claude-opus-5 ')!;
  price.inputPerM = 0;
  assert.equal(getAiModelPricing('claude-opus-5')!.inputPerM, 5);
  assert.equal(getAiModelPricing(undefined), null);
  assert.equal(getAiModelPricing(42), null);
  assert.equal(getAiModelPricing('not-a-model'), null);
  assert.equal(publicAiModelPricing('nope'), null);
  assert.deepEqual(publicAiModelPricing('gpt-5.6-sol'), { inputPerM: 2.5, outputPerM: 15, estimated: true });
  assert.equal('cacheReadPerM' in (publicAiModelPricing('claude-opus-5') as object), false);
});

test('priceTurn is exact micro arithmetic, rounded half up', () => {
  // one token at $5/M input is exactly 5 micros; output 25 micros
  assert.deepEqual(priceTurn('claude-opus-5', { inputTokens: 1, outputTokens: 1 }), { costMicros: 30, priced: true, estimated: false });
  // 1M in + 1M out = $5 + $25 = 30 credits
  assert.equal(priceTurn('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }).costMicros, 30 * MICROS_PER_CREDIT);
  // sub-micro fractions round half up: gpt-4o-mini input is 0.15 micros/token
  assert.equal(priceTurn('gpt-4o-mini', { inputTokens: 3, outputTokens: 0 }).costMicros, 0); // 0.45 → 0
  assert.equal(priceTurn('gpt-4o-mini', { inputTokens: 4, outputTokens: 0 }).costMicros, 1); // 0.6 → 1
  assert.equal(priceTurn('gpt-4o-mini', { inputTokens: 10, outputTokens: 0 }).costMicros, 2); // 1.5 → 2 (half up)
  // the synthetic test usage: 100 in / 50 out per hop = 0.2 credits
  assert.equal(priceTurn(LOPU_TEST_MODEL_ID, { inputTokens: 100, outputTokens: 50 }).costMicros, 200_000);
  assert.equal(priceTurn(LOPU_TEST_MODEL_ID, { inputTokens: 300, outputTokens: 150 }).costMicros, 600_000);
  // an estimated row says so on the priced turn
  assert.deepEqual(priceTurn('gpt-5.5', { inputTokens: 2, outputTokens: 1 }), { costMicros: 20, priced: true, estimated: true });
});

test('cache tokens bill at the cache rates when present and fold into input otherwise', () => {
  // Opus 5: cache read 0.5, cache write 6.25 micros per token
  const cached = priceTurn('claude-opus-5', { inputTokens: 10, outputTokens: 0, cacheReadTokens: 100, cacheWriteTokens: 4 });
  assert.equal(cached.costMicros, 10 * 5 + 100 * 0.5 + 4 * 6.25);
  // a row without a cache-write rate bills cache writes as plain input
  assert.equal(priceTurn('gpt-4o', { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 2 }).costMicros, 5);
  // absent / negative / non-numeric tokens count as zero
  assert.equal(priceTurn('claude-opus-5', { inputTokens: -5, outputTokens: 'x' as any }).costMicros, 0);
  assert.equal(priceTurn('claude-opus-5', null).costMicros, 0);
  assert.equal(priceTurn('claude-opus-5', undefined).costMicros, 0);
});

test('an unknown model is unpriced (cost 0), never a guess', () => {
  assert.deepEqual(priceTurn('fake-model', { inputTokens: 1000, outputTokens: 1000 }), { costMicros: 0, priced: false, estimated: false });
  assert.deepEqual(priceTurn(null, { inputTokens: 1000, outputTokens: 1000 }), { costMicros: 0, priced: false, estimated: false });
});

test('credit conversions and display', () => {
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(-2.5), -3);
  assert.equal(roundHalfUp(2.4999), 2);
  assert.equal(roundHalfUp(Number.NaN), 0);
  assert.equal(creditsToMicros(2), 2_000_000);
  assert.equal(creditsToMicros(0.0000005), 1);
  assert.equal(creditsToMicros(-1.25), -1_250_000);
  assert.equal(microsToCredits(4_970_000), 4.97);
  assert.equal(microsToCredits(Number.NaN), 0);
  assert.equal(formatCredits(4_970_000), '4.97 credits');
  assert.equal(formatCredits(1_000_000), '1.00 credits');
  assert.equal(formatCredits(13_200), '1.32¢');
  assert.equal(formatCredits(999_999), '100.00¢');
  assert.equal(formatCredits(5), '<0.01¢');
  assert.equal(formatCredits(0), '0 credits');
  assert.equal(formatCredits(-2_500_000), '-2.50 credits');
  assert.equal(formatCredits(Number.NaN), '0 credits');
});
