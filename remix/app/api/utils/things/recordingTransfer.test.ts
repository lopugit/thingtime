import assert from 'node:assert/strict';
import test from 'node:test';
import { importTransfer } from './importTransfer';
import { recordingTransferFile } from '../../../utils/thingTransfer/recording';
import type { ThingTransfer } from '../../../utils/thingTransfer/format';

const fixture = (): ThingTransfer => ({ format: 'thingtime.transfer', version: 1, roots: ['original'],
  things: [{ id: 'original', thingtime: ['attachment'], crystal: { recordingFileId: 'bytes' } }],
  files: [{ id: 'bytes', targetId: 'original', name: 'clip.wav', mime: 'audio/wav', path: 'files/000000', bytes: 4, sha256: 'a'.repeat(64), title: 'Voice' }] });
const draft = () => ({ shareId: 'new-upload', ownerId: 'owner', attachmentPurpose: 'recording', attachmentImportDraft: true,
  attachmentState: 'ready', attachmentExpiresAt: new Date(Date.now() + 60_000), objectSizeBytes: 4,
  crystal: { name: 'clip.wav', contentType: 'audio/wav', mediaKind: 'audio', size: 4 } }) as any;

test('recording import files into remapped folders only after the folder has been created', async () => {
  const manifest = fixture();
  manifest.things.unshift({ id: 'parent', thingtime: ['folder'], crystal: { name: 'Recordings' } });
  manifest.things[1].folderId = 'parent'; manifest.roots = ['parent'];
  const calls: string[] = []; let parentId = '';
  const result = await importTransfer({ id: 'owner' }, { manifest, files: { bytes: 'new-upload' } }, undefined, {
    getFile: async () => draft(), createRecording: async () => { calls.push('recording'); return draft(); },
    create: async (_owner, input) => { calls.push('folder'); parentId = input.shareId as string; return { ok: true, doc: { shareId: parentId } } as any; },
    moveRecording: async (owner, id, destination) => { calls.push('place'); assert.equal(owner, 'owner'); assert.equal(id, 'new-upload'); assert.equal(destination, parentId); return { id, folderId: destination }; }
  });
  assert.ok(result.ok); assert.deepEqual(calls, ['recording', 'folder', 'place']);
});

test('a standalone recording uses the selected destination and placement failure compensates the new recording', async () => {
  const removed: string[] = [];
  const result = await importTransfer({ id: 'owner' }, { manifest: fixture(), folderId: 'destination', files: { bytes: 'new-upload' } }, undefined, {
    getFile: async () => draft(), createRecording: async () => draft(),
    moveRecording: async (_owner, _id, destination) => { assert.equal(destination, 'destination'); throw new Error('Folder disappeared'); },
    removeFile: async (_owner, { id }: any) => { removed.push(id); return { ok: true } as any; }
  });
  assert.equal(result.ok, false); assert.deepEqual(removed, ['new-upload']);
});

test('recording imports use the dedicated commit and never generic create or annotation', async () => {
  let commits = 0;
  const result = await importTransfer({ id: 'owner' }, { manifest: fixture(), files: { bytes: 'new-upload' } }, undefined, {
    getFile: async () => draft(),
    createRecording: async (owner, id, bytes, patch) => { commits++; assert.equal(owner, 'owner'); assert.equal(id, 'new-upload'); assert.equal(bytes, 4); assert.deepEqual(patch, { title: 'Voice' }); return draft(); },
    create: async () => { throw new Error('must not create generic attachment'); },
    annotate: async () => { throw new Error('must annotate atomically with recording commit'); }
  });
  assert.ok(result.ok); if (!result.ok) return;
  assert.deepEqual(result.roots, ['new-upload']); assert.equal(result.ids.original, 'new-upload'); assert.equal(commits, 1);
});

test('existing recordings fail before mutations and malformed envelopes fail before uploads are inspected', async () => {
  const result = await importTransfer({ id: 'owner' }, { manifest: fixture(), files: { bytes: 'old' } }, undefined, {
    getFile: async () => ({ ...draft(), attachmentImportDraft: undefined }), createRecording: async () => { throw new Error('must not commit'); }
  });
  assert.equal(result.ok, false);
  for (const mutate of [(m: ThingTransfer) => { m.things[0].crystal.ownerId = 'forged'; },
    (m: ThingTransfer) => { m.files = []; }, (m: ThingTransfer) => { m.files[0].targetId = 'other'; }]) {
    const m = fixture(); mutate(m); assert.throws(() => recordingTransferFile(m.things[0], m));
  }
});

test('later mixed-import failure cleans only the newly committed recording through the attachment writer', async () => {
  const manifest = fixture(); manifest.things.push({ id: 'note', thingtime: ['note'], crystal: { text: 'Hello' } });
  const removed: string[] = [];
  const result = await importTransfer({ id: 'owner' }, { manifest, files: { bytes: 'new-upload' } }, undefined, {
    getFile: async () => draft(), createRecording: async () => draft(),
    create: async () => ({ ok: false, status: 400, error: 'later failure' }),
    removeFile: async (_owner, { id }: any) => { removed.push(id); return { ok: true } as any; },
    remove: async () => { throw new Error('must use attachment cleanup'); }
  });
  assert.equal(result.ok, false); assert.deepEqual(removed, ['new-upload']);
});

test('embedded recording references use the new recording ID rather than its portable byte-entry ID', async () => {
  const manifest = fixture();
  manifest.things.push({ id: 'player', thingtime: ['component'], crystal: { render: { tag: 'audio', props: { src: '/api/v1/attachments/content?id=original' } } } });
  let crystal: any;
  const result = await importTransfer({ id: 'owner' }, { manifest, files: { bytes: 'new-upload' } }, undefined, {
    getFile: async () => draft(), createRecording: async () => draft(),
    create: async (_owner, input) => { crystal = input.crystal; return { ok: true, doc: { shareId: input.shareId } } as any; }
  });
  assert.ok(result.ok);
  assert.equal(crystal.render.props.src, '/api/v1/attachments/content?id=new-upload');
});
