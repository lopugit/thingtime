import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectThingCrystal, parseThingInspection } from './thingInspection';
import { boundToolData, validateLopuToolInput } from './chatTools';

test('lossless pages preserve deep forms, long arrays and text through tool-result bounds', () => {
  const form = { render: { children: Array.from({ length: 80 }, (_, id) => ({ id, text: '🍀漢\\\"'.repeat(150) })) } };
  let nested: any = { options: ['Tool', 'Battery'] };
  for (let depth = 0; depth < 20; depth++) nested = { child: nested };
  (form.render as any).nested = nested;
  let offset = 0, revision: string | undefined, reconstructed = '';
  do {
    const page = inspectThingCrystal(form, { path: '/render', offset, revision });
    const payload = { thing: { id: 'form', kind: 'component' }, crystalRead: page };
    assert.deepEqual(boundToolData(payload), payload, 'provider bounding must preserve every page');
    assert.ok(JSON.stringify(payload).length < 16 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 16 * 1024);
    assert.equal(/[\uD800-\uDBFF]$/.test(page.json), false);
    reconstructed += page.json;
    revision = page.revision;
    if (page.nextOffset === null) break;
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  } while (true);
  assert.deepEqual(JSON.parse(reconstructed), form.render);
});

test('JSON pointers select exact public fields, including escaped names and array entries', () => {
  const crystal = { 'a/b': { '~name': [null, { options: ['Tool', 'Battery'] }] } };
  const read = (path: string) => JSON.parse(inspectThingCrystal(crystal, { path, offset: 0 }).json);
  assert.deepEqual(read('/a~1b/~0name/1/options'), ['Tool', 'Battery']);
  assert.equal(read('/a~1b/~0name/0'), null);
  assert.throws(() => read('/constructor'), /does not exist/);
  assert.throws(() => read('/__proto__'), /does not exist/);
  assert.throws(() => read('/a~1b/~0name/2'), /does not exist/);
});

test('pagination rejects mixed revisions and malformed inputs without changing the default read', () => {
  assert.equal(parseThingInspection({}), undefined);
  assert.deepEqual(validateLopuToolInput('get_thing', { id: 'form' }), { ok: true, input: { id: 'form' } });
  for (const input of [{ path: 'render' }, { path: '/bad~escape' }, { offset: -1 }, { offset: 1 }, { offset: '0' }, { revision: 'bad' }, { path: '/x'.repeat(65) }]) {
    assert.equal(validateLopuToolInput('get_thing', { id: 'form', ...input }).ok, false);
  }
  const first = inspectThingCrystal({ text: 'a'.repeat(9000) }, { path: '', offset: 0 });
  assert.throws(() => inspectThingCrystal({ text: 'b'.repeat(9000) }, { path: '', offset: first.nextOffset!, revision: first.revision }), /changed/);
  assert.throws(() => inspectThingCrystal({}, { path: '', offset: 100 }), /beyond/);
});
