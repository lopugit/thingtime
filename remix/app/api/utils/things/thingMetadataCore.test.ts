import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { measureThingJson, summarizeThingAttachments } from './thingMetadataCore';

test('Thing metadata hashes canonical UTF-8 JSON across property reordering and preserves array order', () => {
  const a = { crystal: { b: [{ y: true, x: '📦' }, 3], a: 'é' } };
  const b = { crystal: { a: 'é', b: [{ x: '📦', y: true }, 3] } };
  const canonical = '{"crystal":{"a":"é","b":[{"x":"📦","y":true},3]},"extended":null,"tags":[]}';
  const measured = measureThingJson(a);
  assert.equal(measured.jsonBytes, Buffer.byteLength(canonical, 'utf8'));
  assert.equal(measured.sourceHash, createHash('sha256').update(canonical).digest('hex'));
  assert.deepEqual(measured, measureThingJson(b));
  assert.notEqual(measured.sourceHash, measureThingJson({ crystal: { ...b.crystal, b: [...b.crystal.b].reverse() } }).sourceHash);
});

test('Thing metadata counts exact logical JSON bytes on legacy Date and optional values', () => {
  const source = { crystal: { z: new Date('2020-01-01T00:00:00Z'), a: undefined, b: [undefined] }, extended: null, tags: [] };
  assert.equal(measureThingJson(source).jsonBytes, Buffer.byteLength(JSON.stringify(source), 'utf8'));
  assert.deepEqual(measureThingJson(source), measureThingJson(JSON.parse(JSON.stringify(source))));
});

test('unknown original bytes never become zero or a falsely complete partial total', () => {
  assert.deepEqual(summarizeThingAttachments([]), { attachedBytes: 0, knownAttachedBytes: 0, attachmentCount: 0, unavailableAttachmentCount: 0 });
  assert.deepEqual(summarizeThingAttachments([0, 5632, null]), { attachedBytes: null, knownAttachedBytes: 5632, attachmentCount: 3, unavailableAttachmentCount: 1 });
});
