import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLopuSystemPrompt } from './chatPrompt';
import { composeLopuSurfacePrompt, validateLopuInstructions, validateLopuBasePrompt, validatePromptRevision } from './promptSettingsCore';

test('prompt checklist preserves disabled entries, validates shape and rejects ambiguous flags or ids', () => {
  const rows = [{ id: 'on', text: ' Be brief. ', enabled: true }, { id: 'off', text: 'Disabled secret preference.', enabled: false }];
  assert.deepEqual(validateLopuInstructions(rows), [{ ...rows[0], text: 'Be brief.' }, rows[1]]);
  for (const value of [null, {}, [rows[0], rows[0]], [{ ...rows[0], enabled: 'false' }], [{ ...rows[0], text: '' }]]) assert.throws(() => validateLopuInstructions(value));
  assert.equal(validateLopuInstructions(Array.from({length: 40}, (_, i) => ({id: String(i), text: 'a'.repeat(2100), enabled: true}))).length, 40);
  assert.throws(() => validateLopuBasePrompt(' '));
  assert.throws(() => validateLopuBasePrompt('a'.repeat(16001)));
  assert.throws(() => validatePromptRevision(undefined));
});

test('every protocol receives the current base and only this viewer’s enabled instructions; cached grammar never contains private preferences', () => {
  const common = { viewer: { username: 'alice' }, context: {}, activePage: null };
  const settings = { basePrompt: 'Current admin prompt', instructions: [{ id: 'on', text: 'Alice private preference', enabled: true }, { id: 'off', text: 'Disabled secret preference', enabled: false }] };
  for (const toolProtocol of ['native', 'text', 'none'] as const) {
    const alice = buildLopuSystemPrompt({ ...common, toolProtocol, promptSettings: settings });
    assert.ok(alice.stable.startsWith(settings.basePrompt));
    assert.match(alice.text, /Alice private preference/);
    assert.doesNotMatch(alice.stable, /Alice private/);
    assert.doesNotMatch(alice.text, /Disabled secret preference/);
    assert.match(alice.text, /Confirm card/);
    const bob = buildLopuSystemPrompt({ ...common, viewer: { username: 'bob' }, toolProtocol, promptSettings: { basePrompt: 'Updated admin prompt', instructions: [] } });
    assert.ok(bob.stable.startsWith('Updated admin prompt'));
    assert.doesNotMatch(bob.text, /Alice private|Disabled secret|Current admin prompt/);
  }
  const surface = composeLopuSurfacePrompt(settings, 'Spoken reply');
  assert.match(surface, /Current admin prompt/);
  assert.match(surface, /Alice private preference/);
  assert.doesNotMatch(surface, /Disabled secret preference/);
});
