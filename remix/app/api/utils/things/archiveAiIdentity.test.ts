import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveAiIdentity } from './archiveAiIdentity';

const source = (provider: 'claude' | 'chatgpt' | 'lopu' = 'lopu') => ({
  access: provider === 'lopu' ? 'lopu' : 'imported', provider, sourceId: 'private-source',
  label: provider === 'lopu' ? 'Lopu' : provider, connector: 'private-connector', readOnly: true
});

test('historical assistants stay distinct from human owners without copying authority', () => {
  for (const provider of ['lopu', 'claude', 'chatgpt'] as const) {
    const chat = source(provider);
    const result = archiveAiIdentity(chat, { ...chat, role: 'assistant', authorName: 'Historical assistant',
      sessionId: 'private-session', deviceId: 'private-device', capabilities: ['send-message'], token: 'private-token' },
    provider === 'lopu' ? { role: 'assistant', requestId: 'private-request', balanceMicros: 42,
      toolCalls: [{ name: 'send', thingId: 'private-target' }] } : undefined);
    assert.deepEqual(result, { kind: 'historical', provider, role: 'assistant', displayName: 'Historical assistant' });
    assert.doesNotMatch(JSON.stringify(result), /private-|capabilities|toolCalls|balanceMicros/);
  }
});

test('canonical human turns and explicit unknown/system authors retain their distinct mapping', () => {
  assert.deepEqual(archiveAiIdentity(undefined, undefined, undefined), { kind: 'human' });
  assert.deepEqual(archiveAiIdentity(source(), undefined, { role: 'user' }), { kind: 'human' });
  assert.deepEqual(archiveAiIdentity(source('claude'), { ...source('claude'), role: 'user' }, undefined), { kind: 'human' });
  for (const role of ['system', 'unknown'] as const) assert.deepEqual(
    archiveAiIdentity(source('claude'), { ...source('claude'), role }, undefined),
    { kind: 'historical', provider: 'claude', role, displayName: 'claude' });
});

test('missing, conflicting and malformed provenance never silently becomes the importer', () => {
  for (const args of [
    [source('claude'), undefined, undefined], [source(), undefined, { role: 'assistant' }],
    [source(), { ...source(), role: 'assistant' }, { role: 'user' }],
    [source(), { ...source(), role: 'assistant', sourceId: 'other' }, undefined],
    [source(), { ...source('claude'), role: 'assistant' }, undefined],
    [undefined, { ...source(), role: 'assistant' }, undefined],
    [source(), source(), undefined], [source(), undefined, { role: 'tool' }],
    [{ provider: 'invented' }, undefined, undefined], [source(), { bad: true }, undefined]
  ]) assert.throws(() => archiveAiIdentity(...args as [unknown, unknown, unknown]), /Historical AI author is unavailable/);
});
