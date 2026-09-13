import assert from 'node:assert/strict';
import test from 'node:test';
import { emojiTransferFile, importedEmojiName } from './emoji';
import type { ThingTransfer } from './format';
import { MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES, CUSTOM_EMOJI_ATTACHMENT_CONTENT_TYPES } from '../../api/utils/attachments/attachments';

const fixture = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['emoji'],
  things: [{ id: 'emoji', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'image' } }],
  files: [{ id: 'image', targetId: 'emoji', path: 'files/000000', name: 'party.gif', mime: 'image/gif', bytes: 20, sha256: 'a'.repeat(64) }] });

test('emoji transfer preserves the exact image entry and permits folder placement', () => {
  const manifest = fixture();
  manifest.things[0].folderId = 'folder';
  assert.equal(emojiTransferFile(manifest.things[0], manifest), manifest.files[0]);
});

test('emoji envelope refuses source scope, authority, mixed kinds and extra children', () => {
  const changes: ((m: ThingTransfer) => void)[] = [
    m => { m.things[0].targetId = 'community'; },
    m => { m.things[0].thingtime.push('data'); },
    m => { m.things[0].crystal.name = 'party\n'; },
    m => { m.things[0].crystal.emojiKey = 'user:somebody:party'; },
    m => { m.things[0].crystal.image = 'data:image/png;base64,AAAA'; },
    m => { m.things[0].extended = { ownerId: 'somebody' }; },
    m => { m.files.push({ ...m.files[0], id: 'second' }); },
    m => { m.files[0].targetId = 'other'; },
    m => { m.files = []; },
    m => { m.links = [{ id: 'external', targetId: 'emoji', url: 'https://example.com/image.png', mediaKind: 'image' }]; },
    m => { m.things.push({ id: 'child', folderId: 'emoji', thingtime: ['data'], crystal: {} }); }
  ];
  for (const change of changes) {
    const manifest = fixture(); change(manifest);
    assert.throws(() => emojiTransferFile(manifest.things[0], manifest));
  }
});

test('emoji archive preflight matches the canonical image size and MIME limits', () => {
  for (const mime of CUSTOM_EMOJI_ATTACHMENT_CONTENT_TYPES) {
    const m = fixture(); m.files[0].mime = mime; m.files[0].bytes = MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES;
    assert.doesNotThrow(() => emojiTransferFile(m.things[0], m));
  }
  for (const bytes of [0, -1, NaN, 1.5, MAX_CUSTOM_EMOJI_ATTACHMENT_BYTES + 1]) {
    const m = fixture(); m.files[0].bytes = bytes;
    assert.throws(() => emojiTransferFile(m.things[0], m));
  }
  const m = fixture(); m.files[0].mime = 'image/svg+xml';
  assert.throws(() => emojiTransferFile(m.things[0], m));
});

test('imported emoji names are bounded, deterministic and never reuse the original', () => {
  assert.equal(importedEmojiName('party', '1234abcd'), 'party-1234abcd');
  assert.equal(importedEmojiName('a'.repeat(32), '1234abcd').length, 32);
  for (const suffix of ['', '../oops!', 'ABCDEF12', '1234abcdx', '1234abcd\n']) assert.throws(() => importedEmojiName('party', suffix));
  assert.throws(() => importedEmojiName('INVALID', '1234abcd'));
  assert.throws(() => importedEmojiName('party\n', '1234abcd'));
});
