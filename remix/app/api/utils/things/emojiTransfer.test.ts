import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferEmoji } from './emojiTransfer';
import type { ThingTransfer } from '../../../utils/thingTransfer/format';

const manifest = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['original'],
  things: [{ id: 'original', thingtime: ['custom-emoji'], crystal: { name: 'party', emojiFileId: 'bytes' } }],
  files: [{ id: 'bytes', name: 'party.png', mime: 'image/png', targetId: 'original', bytes: 32, path: 'files/000000', sha256: 'a'.repeat(64) }] });

test('emoji adapter uses canonical writer with server attempt, new name and personal scope', async () => {
  const m = manifest();
  const id = '12345678-1234-4321-8123-123456789abc';
  const calls: unknown[] = [];
  const result = await createTransferEmoji('recipient', m.things[0], m, 'fresh-upload', {
    uuid: () => id,
    upload: async (...args: any[]) => { calls.push(args); return { ok: true, emoji: { id: 'fresh-emoji' } } as any; },
    remove: async () => ({ ok: true })
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [['recipient', { name: 'party-12345678', attachmentId: 'fresh-upload' }, { id, bytes: 32, mime: 'image/png' }]]);
  assert.equal(m.things[0].crystal.name, 'party');
});

test('invalid source scope is rejected before upload writer, without restoring the source community', async () => {
  const m = manifest(); m.things[0].targetId = 'source-community';
  let calls = 0;
  const deps: any = { uuid: () => { calls++; }, upload: () => { calls++; } };
  await assert.rejects(createTransferEmoji('recipient', m.things[0], m, 'fresh-upload', deps));
  assert.equal(calls, 0);
});

test('writer rejection is preserved and never reported as a successful copy', async () => {
  const m = manifest();
  const rejected = { ok: false, status: 409, error: 'Already attached' } as const;
  const result = await createTransferEmoji('recipient', m.things[0], m, 'fresh-upload', {
    uuid: () => '12345678-1234-4321-8123-123456789abc', upload: async () => rejected,
    remove: async () => ({ ok: true })
  });
  assert.equal(result, rejected);
});
