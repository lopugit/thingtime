import assert from 'node:assert/strict';
import test from 'node:test';
import { RETIRED_THINGS_INDEXES, thingsIndexPlanEntries, thingsIndexPlanNames } from './collections.ts';
import { ordinaryPrefixCandidates, summarizeThingIndexPlan } from './indexAudit.ts';

test('audit records the executable plan without connecting and includes Mongo _id', async () => {
  const entries = await thingsIndexPlanEntries();
  assert.deepEqual(new Set(entries.map(({ name }) => name)), await thingsIndexPlanNames());
  assert.equal(summarizeThingIndexPlan(entries).total, entries.length + 1);
  assert.equal(entries.find(({ name }) => name === 'uniqueKeys_1')?.options.unique, true);
  assert.equal(entries.find(({ name }) => name === 'things_device_ttl')?.options.expireAfterSeconds, 0);
  assert.ok(entries.find(({ name }) => name === 'notification_unread')?.options.partialFilterExpression);
});

test('unused emoji lookup retires without removing its protected uniqueness or legacy constraint', async () => {
  const entries = await thingsIndexPlanEntries();
  assert.equal(entries.some(({ name }) => name === 'things_emoji_key_lookup'), false);
  assert.ok(RETIRED_THINGS_INDEXES.includes('things_emoji_key_lookup'));
  assert.equal((RETIRED_THINGS_INDEXES as readonly string[]).includes('things_emoji_key_unique'), false);
  assert.equal(entries.find(({ name }) => name === 'uniqueKeys_1')?.options.unique, true);
  assert.ok(summarizeThingIndexPlan(entries).total <= 59);
});

test('prefix audit never conflates constraint, partial, sparse, TTL, text or collation semantics', () => {
  const long = { name: 'long', keys: { a: 1, b: -1 }, options: {} };
  const short = { name: 'short', keys: { a: 1 }, options: {} };
  assert.deepEqual(ordinaryPrefixCandidates([short, long]), [{ candidate: 'short', covering: 'long' }]);
  for (const options of [{ unique: true }, { sparse: true }, { expireAfterSeconds: 0 },
    { partialFilterExpression: { unread: true } }, { collation: { locale: 'en' } }, { hidden: true }]) {
    assert.deepEqual(ordinaryPrefixCandidates([{ ...short, options }, long]), []);
    assert.deepEqual(ordinaryPrefixCandidates([short, { ...long, options }]), []);
  }
  assert.deepEqual(ordinaryPrefixCandidates([{ ...short, keys: { a: 'text' } }, long]), []);
  assert.deepEqual(ordinaryPrefixCandidates([{ ...short, keys: { a: -1 } }, long]), []);
});
