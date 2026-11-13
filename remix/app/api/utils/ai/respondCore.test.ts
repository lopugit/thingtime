import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAiRespondInput, AI_RESPOND_MAX_OUTPUT_TOKENS, AI_RESPOND_MODEL } from './respondCore';
import { patScopeCovers } from '../auth/patScopes';
import { thingtimeCapabilityManifest } from '../capabilities/thingtimeCapabilities';

test('stateless response accepts only bounded prompt text', () => {
  assert.deepEqual(parseAiRespondInput({ prompt: ' Hello ' }), { prompt: 'Hello' });
  for (const input of [null, {}, { prompt: '' }, { prompt: 'x'.repeat(4001) },
    { prompt: 'Hi', chatId: 'owner-chat' }, { prompt: 'Hi', thingIds: [] },
    { prompt: 'Hi', connectionIds: [] }, { prompt: 'Hi', model: 'anything' },
    { prompt: 'Hi', url: 'https://example.test' }]) {
    assert.throws(() => parseAiRespondInput(input), TypeError);
  }
  assert.equal(AI_RESPOND_MODEL, 'gpt-4o-mini');
  assert.equal(AI_RESPOND_MAX_OUTPUT_TOKENS, 500);
});

test('AI permission is independent of all Things and private reporting', () => {
  assert.equal(patScopeCovers(['ai.complete'], 'ai.complete'), true);
  for (const scope of ['things', 'things.read', 'agents.report']) {
    assert.equal(patScopeCovers(['ai.complete'], scope), false);
    assert.equal(patScopeCovers([scope], 'ai.complete'), false);
  }
  const manifest = thingtimeCapabilityManifest('https://thingtime.com');
  assert.equal(manifest.features['api.ai-respond'].version, '1.0.0');
  assert.ok(manifest.operations.some((operation) => operation.path === '/api/v1/ai/respond' && operation.methods.includes('POST')));
});
