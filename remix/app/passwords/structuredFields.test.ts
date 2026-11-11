import assert from 'node:assert/strict';
import test from 'node:test';
import { importOnePasswordItem, exportOnePasswordItem } from './onePassword';
import { validatePasswordEntry, type PasswordField } from './model';
import { passwordProperties, passwordPropertyShape, patchPasswordProperty, readPasswordProperty } from './structuredFields';
const field = (value: unknown): PasswordField => ({ id: 'address', label: 'Address', type: 'address', value: JSON.stringify(value), structured: true });
test('nested properties patch only the selected own leaf and retain arrays, nulls, types and unknown siblings through 1PUX', () => {
  const source = { categoryUuid: '004', overview: { title: 'Synthetic identity' }, details: { sections: [{ fields: [{ title: 'Address', value: { address: { city: 'Old city', unknown: { values: ['one', false, 12.5, null], empty: {}, future: true } } } }] }] } };
  const entry = importOnePasswordItem(source);
  let value = entry.fields[0];
  value = patchPasswordProperty(value, '0', 'New city');
  value = patchPasswordProperty(value, '1.0.0', 'two');
  value = patchPasswordProperty(value, '1.0.1', true);
  value = patchPasswordProperty(value, '1.0.2', '3.125e2');
  assert.deepEqual(JSON.parse(value.value), { city: 'New city', unknown: { values: ['two', true, 312.5, null], empty: {}, future: true } });
  entry.fields[0] = value;
  const exported = exportOnePasswordItem(validatePasswordEntry(entry));
  assert.deepEqual(exported.details.sections[0].fields[0].value.address, JSON.parse(value.value));
  delete exported.details.thingtime;
  assert.deepEqual(importOnePasswordItem(exported).fields[0].value, value.value);
  assert.equal(readPasswordProperty(value, '1.0.2'), '312.5');
  assert.equal(readPasswordProperty(value, '1.0.2', true), 'unknown / values / Item 3');
});
test('property types are strict; null and empty containers explicitly retain JSON fallback', () => {
  const input = field({ number: 3, enabled: false, nothing: null, empty: [], text: 'text' });
  for (const [path, value] of [['0', ''], ['0', '1e400'], ['0', '0x10'], ['0', 'NaN'], ['1', 'yes'], ['2', 'new'], ['3', 'new'], ['4', false]] as const) assert.throws(() => patchPasswordProperty(input, path, value));
  assert.deepEqual(passwordProperties(input)?.map(property => property.kind), ['number', 'boolean', 'null', 'array', 'string']);
  assert.equal(JSON.parse(patchPasswordProperty(input, '1', 'true').value).enabled, true);
  assert.equal(JSON.parse(patchPasswordProperty(input, '4', '').value).text, '');
});
test('prototype, inherited, malformed and missing paths are refused without modifying input', () => {
  const input = field({ city: 'Unchanged' }), before = input.value;
  for (const path of ['__proto__', 'constructor.prototype', '-1', '00', '1', '0.0', '9007199254740992', null, ['city'], {}, '0.__proto__']) assert.throws(() => patchPasswordProperty(input, path, 'bad'));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const unsafe = { ...input, value: `{"nested":{"${key}":"preserve"}}` };
    assert.equal(passwordProperties(unsafe), null);
    assert.throws(() => patchPasswordProperty(unsafe, '0.0', 'bad'));
  }
  assert.equal(input.value, before); assert.equal(({} as any).polluted, undefined);
});
test('private shape identity changes on key/order/type changes but never on ordinary value edits', () => {
  const original = field({ city: 'Old', country: 'AU' });
  assert.equal(passwordPropertyShape(original), passwordPropertyShape(patchPasswordProperty(original, '0', 'New')));
  for (const value of [{ country: 'AU', city: 'Old' }, { city: 1, country: 'AU' }, { town: 'Old', country: 'AU' }]) assert.notEqual(passwordPropertyShape(original), passwordPropertyShape(field(value)));
});
test('secret parents and unknown members stay masked; unsupported types retain raw JSON', () => {
  assert.deepEqual(passwordProperties(field({ city: 'City', unknown: 'secret' }))?.map(property => property.secret), [false, true]);
  assert.ok(passwordProperties({ ...field({ privateKey: 'key', metadata: { publicKey: 'public' } }), type: 'ssh-key' })?.every(property => property.secret));
  assert.equal(passwordProperties({ ...field({ future: true }), type: 'structured' }), null);
  assert.equal(passwordProperties({ ...field({ city: 'City' }), structured: false }), null);
  assert.equal(passwordProperties({ ...field({ city: 'City' }), value: '{invalid' }), null);
});
test('unsafe numeric siblings retain exact raw JSON and refuse property edits instead of rounding or becoming null', () => {
  for (const literal of ['9007199254740993', '9007199254740992', '1e400', '1e-400', '0.123456789012345678901', '-0']) {
    const original = ` { "city": "Old", "future": ${literal} } `;
    const value = { ...field({}), value: original };
    assert.equal(passwordProperties(value), null, literal);
    assert.throws(() => patchPasswordProperty(value, '0', 'New'));
    assert.equal(value.value, original);
  }
  const safe = { ...field({}), value: '{"city":"Old","future":[1.00,1.25e2,0.1],"text":"9007199254740993 and 1e400"}' };
  assert.ok(passwordProperties(safe));
  assert.deepEqual(JSON.parse(patchPasswordProperty(safe, '0', 'New').value), { city: 'New', future: [1, 125, 0.1], text: '9007199254740993 and 1e400' });
  const number = { ...field({}), value: '12', type: 'date' as const };
  for (const literal of ['9007199254740993', '1e400', '1e-400', '0.123456789012345678901']) assert.throws(() => patchPasswordProperty(number, 'root', literal));
});
test('duplicate raw object keys retain masked JSON fallback including nested and escaped duplicate names', () => {
  for (const original of ['{"city":"Old","city":"Duplicate"}', '{"city":"Old","future":{"key":1,"key":2}}', '{"city":"Old","future":[{"key":1,"\\u006bey":2}]}']) {
    const value = { ...field({}), value: original };
    assert.equal(passwordProperties(value), null);
    assert.throws(() => patchPasswordProperty(value, '0', 'New'));
    assert.equal(value.value, original);
  }
  assert.ok(passwordProperties(field({ city: 'Old', future: [{ key: 1 }, { key: 2 }], quoted: '"key":1, "key":2' })));
});
