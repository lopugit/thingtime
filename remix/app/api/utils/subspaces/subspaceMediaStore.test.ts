import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubspaceMediaReconciler } from './subspaceMediaStore';

const image = { objectSizeBytes: 123, crystal: { mediaKind: 'image', contentType: 'image/png', size: 123 } };
const setup = () => {
  const calls: any[] = [];
  let permitted = true;
  let selected: any = image;
  const session = { transaction: true };
  const reconcile = createSubspaceMediaReconciler({
    canUpload: async () => permitted,
    bind: async (...args) => { calls.push(['bind', ...args]); }
  });
  const input = { things: {
    findOne: async (filter: any, options: any) => { calls.push(['find', filter, options]); return selected; },
    updateOne: async (...args: any[]) => { calls.push(['retire', ...args]); }
  }, session, actorId: 'moderator', current: { shareId: 'space', iconAttachmentId: 'old' }, branding: {} as any, legacyBranding: undefined, media: {} as any, now: new Date() };
  return { reconcile, input, calls, deny: () => { permitted = false; }, image: (value: any) => { selected = value; } };
};

test('image replacement binds uploader and exact slot within the parent transaction, then retires old bytes', async () => {
  const t = setup(); t.input.media = { icon: { kind: 'attachment', attachmentId: 'new' } };
  assert.deepEqual(await t.reconcile(t.input), { iconAttachmentId: 'new' });
  assert.deepEqual(t.calls[0], ['find', { shareId: 'new', ownerId: 'moderator', thingtime: 'attachment' }, { session: t.input.session }]);
  assert.deepEqual(t.calls[1], ['bind', 'moderator', ['new'], 'space', t.input.session, 'subspace-icon', 1]);
  assert.equal(t.calls[2][1].shareId, 'old');
  assert.equal(t.calls[2][2].$unset.targetId, '');
  assert.equal(t.calls[2][2].$set.attachmentExpiresAt, t.input.now);
  assert.equal(t.input.branding.iconUrl, null);
});

test('preserve and idempotent same-image retry do not retire a saved image', async () => {
  const t = setup(); t.input.media = { icon: { kind: 'preserve' } };
  assert.deepEqual(await t.reconcile(t.input), {}); assert.equal(t.calls.length, 0);
  t.input.media = { icon: { kind: 'attachment', attachmentId: 'old' } };
  assert.deepEqual(await t.reconcile(t.input), { iconAttachmentId: 'old' });
  assert.equal(t.calls.some(c => c[0] === 'retire'), false);
});

test('external fallback and removal clear managed references, including legacy branding reset', async () => {
  for (const mutation of [{ kind: 'external', url: 'https://example.com/a.png' }, { kind: 'clear' }]) {
    const t = setup(); t.input.media = { icon: mutation };
    assert.deepEqual(await t.reconcile(t.input), { iconAttachmentId: null });
    assert.equal(t.input.branding.iconUrl, 'url' in mutation ? mutation.url : null);
    assert.equal(t.calls[0][0], 'retire');
  }
  const t = setup(); (t.input as any).legacyBranding = null;
  assert.deepEqual(await t.reconcile(t.input), { iconAttachmentId: null, bannerAttachmentId: null });
});

test('approval, wrong owner, unsupported content and size mismatch fail before any binding or retirement', async () => {
  for (const selected of [null, { ...image, objectSizeBytes: 64 * 1024 * 1024 + 1 }, { ...image, objectSizeBytes: NaN }, { ...image, crystal: { ...image.crystal, contentType: 'image/svg+xml' } }, { ...image, crystal: { ...image.crystal, size: 99 } }]) {
    const t = setup(); t.input.media = { icon: { kind: 'attachment', attachmentId: 'new' } }; t.image(selected);
    await assert.rejects(t.reconcile(t.input));
    assert.equal(t.calls.some(c => c[0] !== 'find'), false);
  }
  const t = setup(); t.input.media = { icon: { kind: 'attachment', attachmentId: 'new' } }; t.deny();
  await assert.rejects(t.reconcile(t.input), /approval/); assert.equal(t.calls.length, 0);
});
