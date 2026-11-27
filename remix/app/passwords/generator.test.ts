import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { DEFAULT_GENERATOR_SETTINGS as defaults, PASSWORD_PRESETS, generatePassword, generatorAlphabet, settingsForPreset } from './generator';
const crypto = webcrypto as unknown as Crypto;
const immediate = async () => {};
test('secure defaults generate exact length and each enabled class', async () => {
  const values = await Promise.all(Array.from({ length: 24 }, () => generatePassword(defaults, { crypto, yieldControl: immediate })));
  for (const value of values) { assert.equal(Array.from(value).length, 20); for (const group of generatorAlphabet(defaults)) assert.ok(Array.from(value).some(char => group.includes(char))); }
  assert.equal(new Set(values).size, values.length);
});
test('custom Unicode symbols and exclusions are respected by code point', async () => {
  const value = await generatePassword({ ...defaults, length: 80, allowedSymbols: '🦊⚡🦊', excludeAmbiguous: true, excludedCharacters: 'abcABC' }, { crypto, yieldControl: immediate });
  assert.equal(Array.from(value).length, 80); assert.ok(!Array.from(value).some(char => 'Il1O0o|abcABC'.includes(char))); assert.ok(Array.from(value).some(char => char === '🦊' || char === '⚡'));
});
test('invalid or impossible settings fail before consuming randomness', async () => {
  const unavailable = { getRandomValues() { throw new Error('must not request randomness'); } } as unknown as Crypto;
  for (const settings of [
    { ...defaults, length: 0 }, { ...defaults, length: 1.5 }, { ...defaults, length: Infinity }, { ...defaults, length: 3 },
    { ...defaults, uppercase: false, lowercase: false, digits: false, symbols: false }, { ...defaults, allowedSymbols: '' }, { ...defaults, allowedSymbols: 'a0\n' },
    { ...defaults, excludedCharacters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }, { ...settingsForPreset('apple'), digits: false }, { ...settingsForPreset('github'), length: 7 }, { ...settingsForPreset('google'), allowedSymbols: '⚡' }
  ]) await assert.rejects(generatePassword(settings, { crypto: unavailable }), error => error instanceof Error && error.message !== 'must not request randomness');
});
test('Apple avoids triples after shuffling even with repeated random samples', async () => {
  const zeros = { getRandomValues(array: Uint32Array) { array.fill(0); return array; } } as unknown as Crypto;
  const value = await generatePassword({ ...settingsForPreset('apple'), length: 120 }, { crypto: zeros, yieldControl: immediate });
  assert.ok(!/(.)\1\1/u.test(value)); for (const group of generatorAlphabet(settingsForPreset('apple'))) assert.ok(Array.from(value).some(char => group.includes(char)));
});
test('GitHub long branch and Google recommendation preserve actual constraints', () => {
  assert.doesNotThrow(() => generatorAlphabet({ ...settingsForPreset('github'), length: 15, uppercase: false, lowercase: false, symbols: false }));
  assert.doesNotThrow(() => generatorAlphabet({ ...settingsForPreset('google'), length: 8 })); assert.match(PASSWORD_PRESETS.microsoft.guidance, /not been independently verified/);
});
test('rejection sampling discards biased tail and wipes the random buffer', async () => {
  let calls = 0; let buffer: Uint32Array | undefined;
  const controlled = { getRandomValues(array: Uint32Array) { buffer = array; array.fill(++calls === 1 ? 0xffffffff : 0); return array; } } as unknown as Crypto;
  const value = await generatePassword({ ...defaults, uppercase: false, digits: false, symbols: false, length: 4 }, { crypto: controlled, yieldControl: immediate });
  assert.equal(value, 'aaaa'); assert.equal(calls, 2); assert.ok(buffer?.every(item => item === 0));
});
test('large lengths cross WebCrypto quota without an arbitrary product cap', async () => {
  let calls = 0; const bounded = { getRandomValues(array: Uint32Array) { assert.ok(array.byteLength <= 65536); calls++; return crypto.getRandomValues(array); } } as unknown as Crypto;
  const value = await generatePassword({ ...defaults, length: 40000 }, { crypto: bounded, yieldControl: immediate }); assert.equal(value.length, 40000); assert.ok(calls > 1);
});
test('cancellation refuses a partial result and wipes the buffer', async () => {
  const controller = new AbortController(); let buffer: Uint32Array | undefined;
  const tracked = { getRandomValues(array: Uint32Array) { buffer = array; return crypto.getRandomValues(array); } } as unknown as Crypto;
  await assert.rejects(generatePassword({ ...defaults, length: 9000 }, { crypto: tracked, signal: controller.signal, yieldControl: async () => controller.abort() }), { name: 'AbortError' }); assert.ok(buffer?.every(value => value === 0));
});
test('generator document passes canonical editable-block validation', async () => {
  const { PASSWORD_GENERATOR_BLOCKS } = await import('../components/Passwords/passwordGeneratorDocument');
  const { settingsDocumentBlocks } = await import('../components/Settings/settingsDocument');
  assert.deepEqual(settingsDocumentBlocks(PASSWORD_GENERATOR_BLOCKS), PASSWORD_GENERATOR_BLOCKS);
});
test('Google supports configured interior spaces without surrounding spaces or losing classes', async () => {
  const settings = { ...settingsForPreset('google'), length: 4, allowedSymbols: ' ' };
  for (let i = 0; i < 20; i++) {
    const value = await generatePassword(settings, { crypto, yieldControl: immediate });
    assert.equal(value.trim(), value); assert.ok(value.includes(' '));
    for (const group of generatorAlphabet(settings)) assert.ok(Array.from(value).some(char => group.includes(char)));
  }
});
test('actual JavaScript array limit and malformed settings fail before allocation or randomness', async () => {
  const unavailable = { getRandomValues() { throw new Error('must not request randomness'); } } as unknown as Crypto;
  await assert.rejects(generatePassword({ ...defaults, length: 0x100000000 }, { crypto: unavailable }), /JavaScript arrays support at most/);
  for (const settings of [null, undefined, [], { ...defaults, uppercase: 'true' }, { ...defaults, allowedSymbols: null }, { ...defaults, excludedCharacters: 42 }, { ...defaults, preset: '__proto__' }]) {
    await assert.rejects(generatePassword(settings as typeof defaults, { crypto: unavailable }), /settings are invalid/);
  }
});
