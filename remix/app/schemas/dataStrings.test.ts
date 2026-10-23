import assert from 'node:assert/strict';
import test from 'node:test';
import { validateThingtimeCrystal } from './registry';

test('ordinary data strings preserve large text and encrypted payloads exactly', () => {
  const crystal = { name: 'Long name '.repeat(700), body: 'Unicode 🦊\n'.repeat(100000), nested: { cipherText: 'opaque-ciphertext_'.repeat(12000) } };
  const result = validateThingtimeCrystal(['data'], crystal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.crystal, crystal);
});

test('larger data strings do not weaken JSON type or prototype-key validation', () => {
  assert.equal(validateThingtimeCrystal(['data'], { text: 'x'.repeat(10000), invalid: Number.NaN }).ok, false);
  assert.equal(validateThingtimeCrystal(['data'], JSON.parse('{"text":"safe","__proto__":{"admin":true}}')).ok, false);
  const circular: any = { text: 'x'.repeat(10000) }; circular.self = circular;
  assert.equal(validateThingtimeCrystal(['data'], circular).ok, false);
});
