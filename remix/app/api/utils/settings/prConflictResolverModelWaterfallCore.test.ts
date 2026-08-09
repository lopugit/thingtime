import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  normalizePrConflictResolverModelWaterfall,
  PR_CONFLICT_RESOLVER_MODEL_OPTIONS,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  validatePrConflictResolverModelWaterfall
} from './prConflictResolverModelWaterfallCore.ts';

test('publishes the exact singleton key and closed model catalog', () => {
  assert.equal(PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY, 'Thingtime.PRConflictAutoResolverModelWaterfall');
  assert.deepEqual(PR_CONFLICT_RESOLVER_MODEL_OPTIONS, [
    { id: 'default', label: 'Default model', effort: 'max' },
    { id: 'claude-fable-5', label: 'Claude Fable 5', effort: 'max' },
    { id: 'claude-opus-5', label: 'Claude Opus 5', effort: 'max' }
  ]);
  assert.deepEqual(DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL, ['default']);
});

test('missing and corrupt stored values fall back to exactly default', () => {
  const corruptValues = [
    undefined,
    null,
    {},
    'claude-fable-5',
    [],
    ['unknown'],
    ['claude-fable-5', 'claude-fable-5'],
    ['default', 'claude-fable-5', 'claude-opus-5', 'default']
  ];

  for (const value of corruptValues) {
    assert.deepEqual(normalizePrConflictResolverModelWaterfall(value), ['default']);
  }
});

test('normalization preserves valid order and appends the hard fallback when absent', () => {
  assert.deepEqual(
    normalizePrConflictResolverModelWaterfall(['claude-opus-5', 'default', 'claude-fable-5']),
    ['claude-opus-5', 'default', 'claude-fable-5']
  );
  assert.deepEqual(normalizePrConflictResolverModelWaterfall(['claude-fable-5', 'claude-opus-5']), [
    'claude-fable-5',
    'claude-opus-5',
    'default'
  ]);
});

test('strict write validation accepts only unique known ids including default', () => {
  assert.deepEqual(validatePrConflictResolverModelWaterfall(['claude-opus-5', 'default']), {
    ok: true,
    waterfall: ['claude-opus-5', 'default']
  });

  for (const value of [
    undefined,
    [],
    ['claude-fable-5'],
    ['default', 'default'],
    ['default', 'unknown'],
    ['default', 'claude-fable-5', 'claude-opus-5', 'default']
  ]) {
    assert.equal(validatePrConflictResolverModelWaterfall(value).ok, false);
  }
});
