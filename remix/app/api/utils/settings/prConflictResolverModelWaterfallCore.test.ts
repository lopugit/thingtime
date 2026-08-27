import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import {
  AI_WORKFLOW_BASE_MODELS,
  DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL,
  describeAiWorkflowModelChoice,
  normalizePrConflictResolverModelWaterfall,
  parseAiWorkflowModelOptionId,
  PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY,
  resolveAiPreferredAnthropicChoice,
  resolveAiPreferredClaudeModel,
  resolveAiPreferredOpenAiChoice,
  toAnthropicEffort,
  toOpenAiReasoningEffort,
  validatePrConflictResolverModelWaterfall
} from './prConflictResolverModelWaterfallCore.ts';

test('publishes the exact singleton key and a multi-provider base-model catalog', () => {
  assert.equal(PR_CONFLICT_RESOLVER_MODEL_WATERFALL_KEY, 'Thingtime.PRConflictAutoResolverModelWaterfall');
  assert.deepEqual(DEFAULT_PR_CONFLICT_RESOLVER_MODEL_WATERFALL, ['default']);

  const ids = AI_WORKFLOW_BASE_MODELS.map((model) => model.id);
  // The historical closed catalog must survive as bare ids so stored orders
  // and the workflow control plane keep resolving.
  for (const legacy of ['default', 'claude-fable-5', 'claude-opus-5']) {
    assert.ok(ids.includes(legacy), `catalog keeps legacy id ${legacy}`);
  }
  assert.ok(AI_WORKFLOW_BASE_MODELS.some((model) => model.provider === 'anthropic'));
  assert.ok(AI_WORKFLOW_BASE_MODELS.some((model) => model.provider === 'openai'));
  assert.equal(new Set(ids).size, ids.length, 'base model ids are unique');
  for (const model of AI_WORKFLOW_BASE_MODELS) {
    assert.ok(model.speeds.includes('normal'), `${model.id} always offers normal speed`);
    assert.ok(!model.id.includes(':'), `${model.id} must not collide with the composed-id grammar`);
  }
});

test('composed option ids parse, canonicalize segment order, and reject invalid combos', () => {
  assert.deepEqual(parseAiWorkflowModelOptionId('claude-opus-5'), {
    id: 'claude-opus-5',
    model: 'claude-opus-5',
    label: 'Claude Opus 5',
    provider: 'anthropic',
    effort: null,
    speed: 'normal'
  });
  assert.deepEqual(parseAiWorkflowModelOptionId('gpt-5.6-sol:ultra:fast'), {
    id: 'gpt-5.6-sol:ultra:fast',
    model: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol',
    provider: 'openai',
    effort: 'ultra',
    speed: 'fast'
  });
  // Tolerated segment order, canonical output.
  assert.equal(parseAiWorkflowModelOptionId('claude-opus-5:fast:high')?.id, 'claude-opus-5:high:fast');

  for (const invalid of [
    undefined,
    null,
    42,
    '',
    'unknown-model',
    'claude-fable-5:fast', // Fable has no fast mode
    'claude-haiku-4-5:high', // Haiku has no effort tiers
    'claude-opus-5:ultra', // ultra is not a Claude tier
    'claude-opus-4-6:xhigh', // xhigh arrived with Opus 4.7
    'gpt-5.3-codex:fast', // codex models have no priority lane
    'claude-opus-5:high:high',
    'claude-opus-5:fast:fast',
    'default:fast'
  ]) {
    assert.equal(parseAiWorkflowModelOptionId(invalid), null, `rejects ${String(invalid)}`);
  }
});

test('missing and corrupt stored values fall back to exactly default', () => {
  for (const value of [undefined, null, {}, 'claude-fable-5', [], ['unknown'], [42, 'nope']]) {
    assert.deepEqual(normalizePrConflictResolverModelWaterfall(value), ['default']);
  }
});

test('normalization is forgiving per entry: drops unknowns, dedupes, appends the hard fallback', () => {
  assert.deepEqual(
    normalizePrConflictResolverModelWaterfall(['claude-opus-5', 'default', 'claude-fable-5']),
    ['claude-opus-5', 'default', 'claude-fable-5']
  );
  assert.deepEqual(normalizePrConflictResolverModelWaterfall(['claude-fable-5', 'claude-opus-5']), [
    'claude-fable-5',
    'claude-opus-5',
    'default'
  ]);
  // A newer deploy's unknown id no longer nukes the rest of the order.
  assert.deepEqual(
    normalizePrConflictResolverModelWaterfall(['some-future-model', 'claude-opus-5:high', 'default']),
    ['claude-opus-5:high', 'default']
  );
  // Duplicates keep their first position; non-canonical ids normalize.
  assert.deepEqual(
    normalizePrConflictResolverModelWaterfall(['claude-opus-5:fast:high', 'claude-opus-5:high:fast', 'default']),
    ['claude-opus-5:high:fast', 'default']
  );
});

test('provider resolution skips the other provider and stops at the default sentinel', () => {
  const waterfall = ['gpt-5.6-sol:xhigh', 'claude-opus-5:high:fast', 'gpt-4o', 'default'];

  const anthropic = resolveAiPreferredAnthropicChoice(waterfall, 'provider-default');
  assert.deepEqual(
    { model: anthropic.model, effort: anthropic.effort, speed: anthropic.speed },
    { model: 'claude-opus-5', effort: 'high', speed: 'fast' }
  );
  assert.equal(resolveAiPreferredClaudeModel(waterfall, 'provider-default'), 'claude-opus-5');

  const openai = resolveAiPreferredOpenAiChoice(waterfall);
  assert.deepEqual(
    { model: openai?.model, effort: openai?.effort, speed: openai?.speed },
    { model: 'gpt-5.6-sol', effort: 'xhigh', speed: 'normal' }
  );

  // default outranks entries below it for both providers.
  assert.equal(resolveAiPreferredClaudeModel(['default', 'claude-opus-5'], 'provider-default'), 'provider-default');
  assert.equal(resolveAiPreferredOpenAiChoice(['claude-opus-5', 'default', 'gpt-4o']), null);
  assert.equal(resolveAiPreferredClaudeModel(['unknown'], 'provider-default'), 'provider-default');
});

test('provider API effort mappings clamp to what each API accepts', () => {
  assert.equal(toAnthropicEffort('max'), 'max');
  assert.equal(toAnthropicEffort('none'), null);
  assert.equal(toAnthropicEffort(null), null);
  assert.equal(toOpenAiReasoningEffort('ultra'), 'max');
  assert.equal(toOpenAiReasoningEffort('none'), 'none');
  assert.equal(toOpenAiReasoningEffort(null), null);
});

test('strict write validation accepts unlimited unique known ids including default', () => {
  assert.deepEqual(validatePrConflictResolverModelWaterfall(['claude-opus-5', 'default']), {
    ok: true,
    waterfall: ['claude-opus-5', 'default']
  });

  // Far beyond the historical 3-entry cap, mixing providers and variants.
  const long = [
    'claude-fable-5:max',
    'claude-opus-5:high:fast',
    'claude-opus-4-8',
    'claude-sonnet-5:xhigh',
    'claude-haiku-4-5',
    'gpt-5.6-sol:ultra',
    'gpt-5.6-terra:high:fast',
    'gpt-5.3-codex:xhigh',
    'gpt-5.2',
    'o3:high',
    'gpt-4o:fast',
    'default'
  ];
  assert.deepEqual(validatePrConflictResolverModelWaterfall(long), { ok: true, waterfall: long });

  // Non-canonical input is stored canonically.
  assert.deepEqual(validatePrConflictResolverModelWaterfall(['claude-opus-5:fast:high', 'default']), {
    ok: true,
    waterfall: ['claude-opus-5:high:fast', 'default']
  });

  for (const value of [
    undefined,
    [],
    ['claude-fable-5'], // missing default
    ['default', 'default'],
    ['default', 'unknown'],
    ['default', 'claude-fable-5:fast'], // invalid combo
    ['default', 'claude-opus-5:high:fast', 'claude-opus-5:fast:high'] // same entry, non-canonical dup
  ]) {
    assert.equal(validatePrConflictResolverModelWaterfall(value).ok, false);
  }
});

const describeById = (id: string) => {
  const choice = parseAiWorkflowModelOptionId(id);
  assert.ok(choice, `expected ${id} to parse`);
  return describeAiWorkflowModelChoice(choice);
};

test('entry descriptions cover provider, effort, and speed', () => {
  assert.equal(describeById('default'), 'Provider-selected model · always included');
  assert.equal(describeById('claude-opus-5'), 'Anthropic · Default effort');
  assert.equal(describeById('gpt-5.6-sol:ultra:fast'), 'OpenAI · Ultra effort · Fast mode');
});
