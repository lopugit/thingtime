import assert from 'node:assert/strict';
import test from 'node:test';
import { canView, canViewInherited, sanitizeShareId } from './things';

test('generic writes cannot squat automatic subspace messaging IDs', () => {
  for (const id of ['subspace-space-example', 'subspace-general-example']) {
    assert.deepEqual(sanitizeShareId(id), { ok: false, status: 400, error: 'shareId uses a reserved prefix' });
  }
  assert.equal(sanitizeShareId('ordinary-user-thing'), 'ordinary-user-thing');
});

test('placement metadata cannot bypass current moderator permissions through generic owner reads', async () => {
  const row: any = { shareId: 'placement', ownerId: 'former-mod', thingtime: ['subspace-embed'], acl: ['tt:user'], crystal: {} };
  const viewer: any = { id: 'former-mod' };
  assert.equal(canView(row, viewer), false);
  assert.equal(await canViewInherited(row, viewer), false);
});
