import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyPasswordEntry, validatePasswordEntry } from './model';
import { decodeBase32, parseTotp, totpCode } from './totp';
import { exportPasswords, exportPasswordBackup, import1Pux, importPasswordCsv, parsePasswordCsv } from './transfer';
import { moveThingField } from '../components/Thingtime/thingMods';
const fixture = () => { const entry = emptyPasswordEntry(); entry.title = 'Quoted "login", ☁'; entry.fields[0].value = 'owner@example.test'; entry.fields[1].value = ' =exact,"secret"\r\nno trim '; entry.fields[2].value = 'https://example.test/'; entry.fields.push({ id: 'notes', label: 'Notes', type: 'notes', value: 'first\nsecond' }, { id: 'otp', label: 'Authenticator', type: 'totp', value: 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' }); return entry; };
test('all CSV formats preserve quoted and multiline passwords exactly', () => {
  for (const format of ['chrome', 'apple', '1password'] as const) {
    const entry = fixture(), output = exportPasswords([entry], format), decoded = importPasswordCsv(new TextDecoder().decode(output.bytes)).entries[0];
    assert.equal(decoded.title, entry.title); assert.equal(decoded.fields[1].value, entry.fields[1].value); assert.equal(decoded.fields.find(f => f.id === 'notes')?.value, 'first\nsecond');
    assert.equal(decoded.fields.some(f => f.type === 'totp'), format !== 'chrome');
  }
});
test('1PUX preserves multiple accounts and custom concealed and authenticator fields', () => {
  const entry = fixture(); entry.fields.push({ id: 'pin', label: 'PIN', type: 'password', value: '12345' });
  const result = import1Pux(exportPasswords([entry, { ...entry, title: 'Second account' }], '1pux').bytes);
  assert.equal(result.entries.length, 2); assert.equal(result.entries[0].fields[1].value, entry.fields[1].value);
  assert.equal(result.entries[0].fields.find(f => f.label.endsWith('PIN'))?.value, '12345'); assert.equal(result.entries[0].fields.find(f => f.type === 'totp')?.value, entry.fields.find(f => f.type === 'totp')?.value);
});
test('CSV rejects malformed structure and preserves unknown columns as custom fields', () => {
  assert.throws(() => parsePasswordCsv('a\n"unterminated')); assert.throws(() => importPasswordCsv('password,password\na,b'));
  assert.throws(() => importPasswordCsv('name,password\nonly-title'));
  assert.equal(importPasswordCsv('\uFEFFTitle,Password,Recovery\r\nExample,pw,recovery-code').entries[0].fields.find(f => f.label === 'Recovery')?.value, 'recovery-code');
});
test('field schema rejects prototype keys, duplicate ids, and oversized input without altering secret whitespace', () => {
  const entry = fixture(); assert.equal(validatePasswordEntry(entry).fields[1].value, entry.fields[1].value);
  assert.throws(() => validatePasswordEntry({ ...entry, fields: [...entry.fields, entry.fields[0]] }));
  assert.throws(() => validatePasswordEntry({ ...entry, fields: [{ id: '__proto__', label: 'bad', type: 'text', value: '' }] }));
  assert.throws(() => validatePasswordEntry({ ...entry, fields: [{ ...entry.fields[0], value: 'x'.repeat(16385) }] }));
  assert.deepEqual(moveThingField(['username', 'password', 'website'], 1, -1), ['password', 'username', 'website']);
});
test('TOTP RFC 6238 SHA1 vectors including times beyond 2038', async () => {
  for (const [seconds, code] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']] as const) {
    assert.equal((await totpCode('otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8', seconds * 1000)).code, code);
  }
});
test('TOTP parsing rejects handoff QR, HOTP, duplicate options and invalid parameters', () => {
  for (const value of ['FIDO:/123456', 'otpauth://hotp/Test?secret=GEZDGNBVGY3TQOJQ', 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ&digits=5', 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ&period=0', 'otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQ&secret=GEZDGNBVGY3TQOJQ']) assert.throws(() => parseTotp(value));
  assert.equal(decodeBase32('GEZDGNBVGY3TQOJQ').length, 10);
});

test('Thingtime 1PUX round trips preserve field ids, labels, ordering and category', () => {
 const entry = fixture(); entry.passwordType = 'api-key'; entry.fields.reverse();
 assert.deepEqual(import1Pux(exportPasswords([entry], '1pux').bytes).entries, [entry]);
});
test('external 1PUX imports use the standard format without the Thingtime extension', async () => {
 const { zipSync, strToU8 } = await import('fflate');
 const data = { accounts: [{ vaults: [{ items: [{ categoryUuid: '001', overview: { title: 'External login', url: 'https://example.test' }, details: { loginFields: [{ designation: 'username', value: 'external@example.test' }, { designation: 'password', value: '  exact external password  ' }], sections: [{ title: 'Recovery', fields: [{ title: 'Secret', value: { concealed: 'fixture-recovery' } }, { title: 'Code', value: { totp: 'otpauth://totp/Fixture?secret=GEZDGNBVGY3TQOJQ' } }] }] } }] }] }] };
 const bytes = zipSync({ 'export.attributes': strToU8('{"version":3}'), 'export.data': strToU8(JSON.stringify(data)) });
 const entry = import1Pux(bytes).entries[0];
 assert.equal(entry.fields[1].value, '  exact external password  ');
 assert.equal(entry.fields.find(field => field.label === 'Recovery · Secret')?.value, 'fixture-recovery');
 assert.equal(entry.fields.filter(field => field.type === 'totp').length, 1);
 assert.throws(() => import1Pux(new Uint8Array([1, 2, 3])));
});

test('large backups split into individually restorable files without dropping accounts', async () => {
 const { unzipSync } = await import('fflate');
 const entries = Array.from({length: 2001}, (_, index) => ({ ...fixture(), title: `Account ${index}` }));
 const backup = exportPasswordBackup(entries, '1pux'); assert.equal(backup.extension, 'zip');
 const restored = Object.entries(unzipSync(backup.bytes)).filter(([name]) => name.endsWith('.1pux')).flatMap(([, bytes]) => import1Pux(bytes).entries);
 assert.deepEqual(restored, entries);
});
