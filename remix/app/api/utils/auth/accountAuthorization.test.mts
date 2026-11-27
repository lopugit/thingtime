import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import { buildUserSecure, createCurrentAccountAuthorizationFence } from './users.ts';
const id = '6af923e9d2868321ffb930f8';
const session = { inTransaction: () => true } as any;
const createHarness = ({ thing = null, legacy = null, match = 1, conflict = false }: any = {}) => {
  const reads: any[] = [], writes: any[] = [];
  const collection = (kind: string, row: any) => ({
    findOne: async (filter: any, options: any) => { reads.push({ kind, filter, options }); return row; },
    updateOne: async (filter: any, update: any, options: any) => {
      writes.push({ kind, filter, update, options });
      if (conflict) throw Object.assign(new Error('Concurrent authority change'), { code: 112 });
      return { matchedCount: match };
    }
  });
  const fence = createCurrentAccountAuthorizationFence({ getThings: async () => collection('thing', thing), getUsers: async () => collection('legacy', legacy) } as any);
  return { fence, reads, writes };
};
const root = (meta: any) => ({ _id: 'physical-user-root', shareId: id, thingtime: ['user'], crystal: { username: 'platform-character' }, ...(() => { const packed = buildUserSecure({ email: '', passwordHash: '', emailVerified: false, accountKind: 'user', meta }); return { secure: packed.secure, secureAdmin: packed.admin }; })() });

test('Things-first authorization decodes current Character/admin state and fences the exact home root', async () => {
  const fixture = createHarness({ thing: root({ admin: true, character: { ownerId: 'owner', loginMode: 'switch', disabled: false } }) });
  const eligible = (user: any) => user.meta.admin && user.meta.character.disabled === false && user.meta.character.ownerId === 'owner';
  assert.equal(await fixture.fence(id, eligible, session, 'same-token'), true);
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.reads[0].options.session, session);
  assert.deepEqual(fixture.writes[0].filter, { _id: 'physical-user-root', shareId: id, thingtime: 'user' });
  assert.equal(fixture.writes[0].options.session, session);
  assert.equal(Object.keys(fixture.writes[0].update.$set).length, 1);
  const first = fixture.writes[0].update.$set.accountAuthorizationFence;
  assert.match(first, /^same-token:[a-f0-9-]{36}$/);
  await fixture.fence(id, eligible, session, 'same-token');
  assert.notEqual(fixture.writes[1].update.$set.accountAuthorizationFence, first, 'a repeated token must still acquire a physical write fence');
});
test('a denied current Thing never falls through to a permissive legacy twin', async () => {
  const fixture = createHarness({ thing: root({ character: { ownerId: 'owner', loginMode: 'switch', disabled: true } }), legacy: { _id: new ObjectId(id), meta: { admin: true } } });
  assert.equal(await fixture.fence(id, (user: any) => user.meta.admin === true, session, 'token'), false);
  assert.equal(fixture.reads.length, 1);
  assert.equal(fixture.writes.length, 0);
});
test('legacy-only identities retain the same-session exact-root fence', async () => {
  const fixture = createHarness({ legacy: { _id: new ObjectId(id), meta: { admin: true } } });
  assert.equal(await fixture.fence(id, (user: any) => user.meta.admin === true, session, 'token'), true);
  assert.deepEqual(fixture.reads.map(read => read.kind), ['thing', 'legacy']);
  assert.equal(String(fixture.writes[0].filter._id), id);
  assert.equal(fixture.writes[0].options.session, session);
});
test('missing, revoked and concurrently changed authority deny or abort without swallowing conflicts', async () => {
  assert.equal(await createHarness().fence(id, () => true, session, 'token'), false);
  assert.equal(await createHarness({ thing: root({ admin: true }), match: 0 }).fence(id, () => true, session, 'token'), false);
  await assert.rejects(createHarness({ thing: root({ admin: true }), conflict: true }).fence(id, () => true, session, 'token'), { code: 112 });
  await assert.rejects(createHarness().fence(id, () => true, { inTransaction: () => false } as any, 'token'), /active transaction/);
  await assert.rejects(createHarness().fence(id, () => true, session, ''), /fence token/);
});
