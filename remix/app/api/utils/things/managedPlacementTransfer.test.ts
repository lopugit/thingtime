// Included by the canonical test:things *Transfer.test.ts suite.
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareManagedPlacement, type PlacementRecord } from './managedPlacementCore';
import { thingStorageSizeBytes } from '../storage/storageCore';

const now = new Date('2026-09-11T12:00:00Z');
const source = (kind = 'theme'): PlacementRecord => ({
  shareId: 'source', ownerId: 'owner', thingtime: [kind], updatedAt: new Date('2026-09-10T12:00:00Z'),
  ...(kind === 'attachment' ? { attachmentPurpose: 'recording', attachmentState: 'ready' } : {})
});
const folder = (): PlacementRecord => ({ ...source('folder'), shareId: 'destination' });

test('managed placement produces only folder and timestamp patches, including root moves', () => {
  for (const kind of ['theme', 'feed-algorithm', 'attachment']) {
    const before = source(kind); const snapshot = structuredClone(before);
    const patch = prepareManagedPlacement(before, 'owner', folder(), now);
    assert.deepEqual(patch, { folderId: 'destination', updatedAt: now });
    assert.notEqual(patch.updatedAt, now);
    assert.deepEqual(prepareManagedPlacement(before, 'owner', null, now), { folderId: null, updatedAt: now });
    assert.deepEqual(before, snapshot);
  }
});

test('managed placement refuses foreign owners, other protected kinds and app namespaces', () => {
  for (const patch of [{ ownerId: 'other' }, { thingtime: ['user'] }, { thingtime: ['theme', 'user'] },
    { appId: 'app' }, { sandbox: true }, { sandboxSpace: 'test' }, { targetId: 'parent' },
    { updatedAt: new Date('invalid') }]) {
    assert.throws(() => prepareManagedPlacement({ ...source(), ...patch }, 'owner', folder(), now));
  }
  for (const patch of [{ ownerId: 'other' }, { thingtime: ['data'] }, { thingtime: ['folder', 'user'] },
    { shareId: 'source' }, { appId: 'app' }, { sandbox: true }, { sandboxSpace: 'test' }]) {
    assert.throws(() => prepareManagedPlacement(source(), 'owner', { ...folder(), ...patch }, now));
  }
});

test('recording placement rejects transient, bound, linked and non-recording attachments', () => {
  for (const patch of [{ attachmentPurpose: 'post' }, { attachmentPurpose: 'message' },
    ...['pending', 'finalizing', 'deleting'].map(attachmentState => ({ attachmentState })),
    { attachmentImportDraft: true }, { attachmentExpiresAt: now }, { attachmentLinked: true },
    { targetId: 'post' }, { attachmentProfileSlot: 'avatar' }]) {
    assert.throws(() => prepareManagedPlacement({ ...source('attachment'), ...patch }, 'owner', folder(), now));
  }
});

test('folder-only placement preserves canonical content storage accounting and authority', () => {
  const before = { ...source(), crystal: { name: 'My theme', theme: { colors: { text: '#123' } } },
    acl: ['tt:user'], tags: ['favorite'], extended: { note: 'keep me' } };
  const after = { ...before, ...prepareManagedPlacement(before, 'owner', folder(), now) };
  assert.equal(thingStorageSizeBytes(after), thingStorageSizeBytes(before));
  for (const key of ['crystal', 'acl', 'tags', 'extended'] as const) assert.equal(after[key], before[key]);
});
