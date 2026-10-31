import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransferEmoji, readTransferEmoji } from './emojiTransfer';
import { importTransfer } from './importTransfer';
import { exportTransferPlan } from './exportTransfer';
import { bundleFromPlan, readTransferClipboard, transferClipboardText } from '../../../utils/thingTransfer/browser';
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

test('emoji reader scopes its query to owner and projects legacy bytes without community or private fields', async () => {
  let reads = 0;
  const deps: any = { custom: () => false, collection: async () => ({ findOne: async (query: unknown) => {
    reads++; assert.deepEqual(query, { ownerId: 'owner', shareId: 'original', thingtime: ['custom-emoji'] });
    return { ownerId: 'owner', shareId: 'original', targetId: 'community', folderId: 'folder', crystal: { name: 'party', image: 'data:image/png;base64,AQID', emojiKey: 'secret' }, secure: 'secret' };
  } }) };
  assert.equal(await readTransferEmoji(undefined, 'original', deps), null); assert.equal(reads, 0);
  const source = await readTransferEmoji('owner', 'original', deps);
  assert.deepEqual(source, { thing: { id: 'original', thingtime: ['custom-emoji'], folderId: 'folder', crystal: { name: 'party', emojiFileId: 'pending' } },
    inlineImage: { name: 'party.png', mime: 'image/png', bytes: 3, base64: 'AQID' } });
  deps.custom = () => true;
  assert.equal(await readTransferEmoji('owner', 'original', deps), null); assert.equal(reads, 1);
});

test('legacy emoji bytes round-trip plan, clipboard ZIP and manifest without a network fetch', async () => {
  const source = { thing: { ...manifest().things[0], crystal: { name: 'party', emojiFileId: 'pending' } },
    inlineImage: { name: 'party.png', mime: 'image/png', bytes: 3, base64: 'AQID' } };
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['original'] }, undefined, {
    read: async () => ({ thingtime: ['custom-emoji'] }) as any, readEmoji: async () => structuredClone(source), bound: async () => []
  });
  assert.ok(result.ok); if (!result.ok) return;
  const bundle = await bundleFromPlan(result.plan, { fetch: async () => { throw new Error('Legacy bytes must not fetch a URL'); } });
  assert.deepEqual([...bundle.files.values()][0], new Uint8Array([1, 2, 3]));
  assert.equal('inlineBase64' in bundle.manifest.files[0], false);
  const roundTrip = await readTransferClipboard(await transferClipboardText(bundle));
  assert.deepEqual(roundTrip.manifest, bundle.manifest); assert.deepEqual(roundTrip.files, bundle.files);
  const excluded = await exportTransferPlan({ id: 'owner' }, { ids: ['original'], includeFiles: false }, undefined, {
    read: async () => ({ thingtime: ['custom-emoji'] }) as any, readEmoji: async () => structuredClone(source)
  });
  assert.equal(excluded.ok, false);
});

test('stored emoji export uses authorized attachment metadata and refuses linked replacements', async () => {
  const deps: any = { read: async () => ({ thingtime: ['custom-emoji'] }),
    readEmoji: async () => ({ thing: structuredClone(manifest().things[0]), attachmentId: 'stored-image' }),
    bound: async () => [], describe: async (viewer: any, id: string) => {
      assert.equal(viewer.id, 'owner'); assert.equal(id, 'stored-image');
      return { ok: true, linked: false, attachment: { name: 'party.png', contentType: 'image/png', size: 32 } };
    } };
  const result = await exportTransferPlan({ id: 'owner' }, { ids: ['original'] }, undefined, deps);
  assert.ok(result.ok); if (result.ok) {
    assert.equal(result.plan.things[0].crystal.emojiFileId, 'stored-image');
    assert.equal(result.plan.files[0].targetId, 'original');
  }
  deps.describe = async () => ({ ok: true, linked: true, attachment: { size: 32, contentType: 'image/png' } });
  assert.equal((await exportTransferPlan({ id: 'owner' }, { ids: ['original'] }, undefined, deps)).ok, false);
});

test('emoji imports use dedicated writer and rollback, not post binding or generic deletion', async () => {
  const m = manifest(); const removed: string[] = [];
  const deps: any = {
    createEmoji: async (owner: string, thing: any, input: any, fileId: string) => {
      assert.equal(owner, 'recipient'); assert.equal(thing.id, 'original'); assert.equal(input.files[0].id, 'bytes'); assert.equal(fileId, 'uploaded');
      return { ok: true, emoji: { id: 'new-emoji' } };
    },
    inspectFiles: async () => { throw new Error('Must not inspect emoji as a post'); },
    removeEmoji: async (owner: string, id: string) => { assert.equal(owner, 'recipient'); removed.push(id); return { ok: true }; },
    moveContent: async () => { throw new Error('Destination disappeared'); },
    remove: async () => { throw new Error('Must not use generic delete'); }
  };
  const success = await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' } }, undefined, deps);
  assert.ok(success.ok); if (success.ok) assert.deepEqual(success.roots, ['new-emoji']);
  const failed = await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' }, folderId: 'destination' }, undefined, deps);
  assert.equal(failed.ok, false); assert.deepEqual(removed, ['new-emoji']);
  deps.removeEmoji = async () => ({ ok: false, status: 503, error: 'Retry cleanup' });
  const pending = await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' }, folderId: 'destination' }, undefined, deps);
  assert.equal(pending.ok, false); if (!pending.ok && 'remainingIds' in pending) assert.deepEqual(pending.remainingIds, ['new-emoji']);
});

test('emoji file annotations are restored only after fresh creation and failure cleans up the new emoji', async () => {
  const m = manifest();
  Object.assign(m.files[0], { title: 'Party image', description: 'Celebration', filenamePreview: 'confetti.png' });
  const calls: string[] = [];
  const deps: any = {
    createEmoji: async () => { calls.push('create'); return { ok: true, emoji: { id: 'new-emoji' } }; },
    annotate: async (owner: string, input: unknown) => {
      calls.push('annotate'); assert.equal(owner, 'recipient');
      assert.deepEqual(input, { id: 'uploaded', title: 'Party image', description: 'Celebration', filenamePreview: 'confetti.png' });
      return { ok: true };
    },
    removeEmoji: async (_owner: string, id: string) => { calls.push(`remove:${id}`); return { ok: true }; }
  };
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' } }, undefined, deps)).ok, true);
  assert.deepEqual(calls, ['create', 'annotate']);
  calls.length = 0;
  deps.annotate = async () => { calls.push('annotate'); return { ok: false, status: 503, error: 'Unavailable' }; };
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' } }, undefined, deps)).ok, false);
  assert.deepEqual(calls, ['create', 'annotate', 'remove:new-emoji']);
  calls.length = 0;
  deps.createEmoji = async () => { calls.push('create'); return { ok: false, status: 409, error: 'Not fresh' }; };
  assert.equal((await importTransfer({ id: 'recipient' }, { manifest: m, files: { bytes: 'uploaded' } }, undefined, deps)).ok, false);
  assert.deepEqual(calls, ['create']);
});
