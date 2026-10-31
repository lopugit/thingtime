import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFreshEmojiImport, matchesEmojiImportAttempt, validateEmojiImportAttempt, type EmojiImportAttempt } from './emojiImportCore';
import type { AttachmentDoc } from './attachmentStore';

const now = new Date('2026-09-12T01:00:00Z');
const attempt = (): EmojiImportAttempt => ({ id: '12345678-1234-4321-8123-123456789abc', bytes: 32, mime: 'image/png' });
const fresh = (): AttachmentDoc => ({ shareId: 'upload', ownerId: 'owner', thingtime: ['attachment'],
  attachmentState: 'ready', attachmentPurpose: 'emoji', attachmentExpiresAt: new Date(now.getTime() + 1000),
  objectSizeBytes: 32, crystal: { name: 'party.png', contentType: 'image/png', mediaKind: 'image', size: 32 }
}) as AttachmentDoc;

test('fresh emoji import validates without modifying upload state or expiry', () => {
  const doc = fresh(), before = structuredClone(doc);
  assert.doesNotThrow(() => assertFreshEmojiImport(doc, 'owner', attempt(), now));
  assert.deepEqual(doc, before);
});

test('emoji import rejects foreign, bound, expired and wrong-purpose uploads', () => {
  const changes: ((doc: AttachmentDoc) => void)[] = [
    d => { d.ownerId = 'other'; }, d => { d.targetId = 'existing-emoji'; },
    d => { d.attachmentPurpose = 'post'; }, d => { d.attachmentState = 'pending'; },
    d => { d.attachmentExpiresAt = now; }, d => { delete d.attachmentExpiresAt; },
    d => { d.attachmentExpiresAt = new Date(NaN); }, d => { d.attachmentLinked = true; },
    d => { d.attachmentProfileSlot = 'avatar'; }, d => { d.attachmentImportDraft = true; },
    d => { d.thingtime = ['attachment', 'data'] as any; }, d => { d.crystal.size++; },
    d => { d.objectSizeBytes = 31; }, d => { d.crystal.contentType = 'image/gif'; },
    d => { d.crystal.mediaKind = 'video'; }, d => { d.moderation = { status: 'blocked' } as any; }
  ];
  for (const change of changes) { const doc = fresh(); change(doc); assert.throws(() => assertFreshEmojiImport(doc, 'owner', attempt(), now)); }
  assert.throws(() => assertFreshEmojiImport(null, 'owner', attempt(), now));
  assert.throws(() => assertFreshEmojiImport(fresh(), '', attempt(), now));
  assert.throws(() => assertFreshEmojiImport(fresh(), 'owner', attempt(), new Date(NaN)));
});

test('attempt validation rejects caller-shaped identities and invalid file declarations', () => {
  for (const patch of [{ id: '' }, { id: attempt().id + '\n' }, { id: 'source-emoji' }, { bytes: 0 },
    { bytes: 1.5 }, { bytes: 512 * 1024 + 1 }, { mime: 'image/svg+xml' }]) {
    assert.throws(() => validateEmojiImportAttempt({ ...attempt(), ...patch }));
  }
});

test('uncertain commit recovery cannot claim a pre-existing emoji or another import attempt', () => {
  assert.equal(matchesEmojiImportAttempt(null, attempt()), false);
  assert.equal(matchesEmojiImportAttempt({}, attempt()), false);
  assert.equal(matchesEmojiImportAttempt({ emojiImportAttemptId: 'other' }, attempt()), false);
  assert.equal(matchesEmojiImportAttempt({ emojiImportAttemptId: attempt().id }, attempt()), true);
});
