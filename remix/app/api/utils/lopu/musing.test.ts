import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import type { PRConflictResolverModelId } from '../settings/prConflictResolverModelWaterfallCore.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createLopuClaudeModelResolver } from './musing.ts';

test('Lopu resolves every Claude call from the current Thingtime Admin preference', async () => {
  let waterfall: PRConflictResolverModelId[] = ['claude-fable-5', 'claude-opus-5', 'default'];
  let reads = 0;
  const resolveModel = createLopuClaudeModelResolver({
    getPreferredModelWaterfall: async () => {
      reads += 1;
      return [...waterfall];
    },
    getProviderDefaultModel: () => 'provider-default'
  });

  assert.equal(await resolveModel(), 'claude-fable-5');
  waterfall = ['claude-opus-5', 'claude-fable-5', 'default'];
  assert.equal(await resolveModel(), 'claude-opus-5');
  assert.equal(reads, 2);
});

test('Lopu delegates the explicit default sentinel to its Anthropic-valid model', async () => {
  const resolveModel = createLopuClaudeModelResolver({
    getPreferredModelWaterfall: async () => ['default'],
    getProviderDefaultModel: () => 'anthropic-provider-default'
  });

  assert.equal(await resolveModel(), 'anthropic-provider-default');
});
