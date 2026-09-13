import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransfer, serializeTransfer, validateTransfer, TRANSFER_FORMAT, TRANSFER_LIMITS, type ThingTransfer } from './format';

const fixture = (): ThingTransfer => ({
  format: TRANSFER_FORMAT, version: 1, roots: ['folder'], files: [], things: [
    { id: 'folder', thingtime: ['folder'], crystal: { name: 'Trip 🥰' } },
    { id: 'data', thingtime: ['data', 'custom-kind'], folderId: 'folder', crystal: { title: 'Photo', values: [null, true, 3.5] }, tags: ['travel'] }
  ]
});

test('portable JSON round-trips Unicode, arbitrary content, kinds, and folder structure', () => {
  assert.deepEqual(parseTransfer(serializeTransfer(fixture())), fixture());
});

test('linked galleries reject unsafe URLs, forged metadata, missing targets and incomplete mixed ordering', () => {
  const value = fixture();
  value.links = [{ id: 'link', targetId: 'data', url: 'https://example.com/a.png', mediaKind: 'image', description: 'First line\nSecond 🥰' }];
  value.attachmentOrder = ['link'];
  assert.deepEqual(parseTransfer(serializeTransfer(value)), value);
  for (const url of ['javascript:alert(1)', 'https://user:secret@example.com/a.png', '//example.com/a.png', 'https://example.com/ a.png']) {
    assert.throws(() => validateTransfer({ ...value, links: [{ ...value.links[0], url }] }), /URL/);
  }
  for (const mutate of [
    (v: any) => { delete v.attachmentOrder; },
    (v: any) => { v.attachmentOrder = []; },
    (v: any) => { v.attachmentOrder = ['link', 'link']; },
    (v: any) => { v.links[0].targetId = 'absent'; },
    (v: any) => { v.links[0].mediaKind = 'video'; },
    (v: any) => { v.links[0].nsfw = false; },
    (v: any) => { v.links[0].id = 'data'; },
    (v: any) => { v.links[0].title = 'title\ncontrol'; }
  ]) { const copy = structuredClone(value); mutate(copy); assert.throws(() => validateTransfer(copy)); }
});

test('rejects ownership, ACLs, tokens and raw database metadata at the record boundary', () => {
  for (const field of ['ownerId', 'author', 'acl', 'linkKey', 'secure', '_id', 'uniqueKeys', 'objectSizeBytes']) {
    const value = fixture();
    Object.assign(value.things[0], { [field]: 'untrusted' });
    assert.throws(() => validateTransfer(value), /Unsupported transfer field/);
  }
});

test('rejects unsupported formats, duplicate IDs, missing roots and missing relations', () => {
  for (const mutate of [
    (v: any) => { v.version = 2; },
    (v: any) => { v.things.push(v.things[0]); },
    (v: any) => { v.roots = ['missing']; },
    (v: any) => { v.things[1].folderId = 'missing'; },
    (v: any) => { v.things[1].targetId = 'missing'; },
    (v: any) => { v.things[0].folderId = 'folder'; }
  ]) {
    const value = fixture(); mutate(value);
    assert.throws(() => validateTransfer(value));
  }
});

test('rejects prototype payloads and excessive JSON depth before import', () => {
  const value = fixture();
  value.things[1].crystal = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => validateTransfer(value), /Unsafe property/);
  value.things[1].crystal = {};
  let cursor = value.things[1].crystal;
  for (let n = 0; n < 70; n++) { cursor.child = {}; cursor = cursor.child; }
  assert.throws(() => validateTransfer(value), /nested too deeply/);
  assert.equal(({} as any).polluted, undefined);
});

test('files use numbered paths and bounded checksummed manifests, never display names as paths', () => {
  const value = fixture();
  value.files.push({ id: 'file', targetId: 'data', path: 'files/000000', name: 'photo.png', mime: 'image/png', bytes: 12, sha256: 'a'.repeat(64), title: 'Photo 🥰', description: 'First\nSecond', filenamePreview: 'Friendly filename' });
  assert.deepEqual(parseTransfer(serializeTransfer(value)), value);
  for (const patch of [{ title: 'bad\nline' }, { description: 'bad\u0000control' }, { filenamePreview: 'x'.repeat(256) }, { nsfw: false }, { detectedContentType: 'image/png' }]) {
    assert.throws(() => validateTransfer({ ...value, files: [{ ...value.files[0], ...patch }] }));
  }
  for (const path of ['../photo', '/etc/file', 'files/../file', 'files\\photo', 'https://example.com/photo', 'files/000001']) {
    assert.throws(() => validateTransfer({ ...value, files: [{ ...value.files[0], path }] }), /archive file path/);
  }
  value.files[0].bytes = TRANSFER_LIMITS.fileBytes + 1;
  assert.throws(() => validateTransfer(value), /too large/);
});

test('malformed JSON and excessive record counts fail without a partial result', () => {
  assert.throws(() => parseTransfer('{'), /valid JSON/);
  const value = fixture();
  value.things = Array(TRANSFER_LIMITS.things + 1).fill(value.things[0]);
  assert.throws(() => validateTransfer(value), /number of Things/);
});
