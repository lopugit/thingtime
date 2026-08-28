import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import type { PRConflictResolverModelId } from '../settings/prConflictResolverModelWaterfallCore.ts';
// @ts-ignore Node executes TypeScript through the repo's tsx test loader.
import { createLopuModelChoicesResolver } from './musing.ts';

test('Lopu resolves every call from the current Thingtime Admin preference, per provider', async () => {
  let waterfall: PRConflictResolverModelId[] = ['claude-fable-5', 'gpt-5.6-sol:xhigh:fast', 'default'];
  let reads = 0;
  const resolveChoices = createLopuModelChoicesResolver({
    getPreferredModelWaterfall: async () => {
      reads += 1;
      return [...waterfall];
    },
    getProviderDefaultModel: () => 'provider-default'
  });

  let choices = await resolveChoices();
  assert.equal(choices.claude.model, 'claude-fable-5');
  assert.equal(choices.openai?.model, 'gpt-5.6-sol');
  assert.equal(choices.openai?.effort, 'xhigh');
  assert.equal(choices.openai?.speed, 'fast');

  waterfall = ['claude-opus-5:high', 'claude-fable-5', 'default'];
  choices = await resolveChoices();
  assert.equal(choices.claude.model, 'claude-opus-5');
  assert.equal(choices.claude.effort, 'high');
  // No OpenAI entry above default: ChatGPT keeps its own provider default.
  assert.equal(choices.openai, null);
  assert.equal(reads, 2);
});

test('Lopu delegates the explicit default sentinel to each provider-valid model', async () => {
  const resolveChoices = createLopuModelChoicesResolver({
    getPreferredModelWaterfall: async () => ['default'],
    getProviderDefaultModel: () => 'anthropic-provider-default'
  });

  const choices = await resolveChoices();
  assert.equal(choices.claude.model, 'anthropic-provider-default');
  assert.equal(choices.claude.effort, null);
  assert.equal(choices.claude.speed, 'normal');
  assert.equal(choices.openai, null);
});
