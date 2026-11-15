import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { normalizeCharacterUsername } from './characterCore.ts';

let users: Map<string, any>;
let receipts: Map<string, any>;
let registrations: any[];
let sequence: number;
const owner = { _id: 'owner', passwordHash: 'owner-password', meta: {}, accountKind: 'user' };
const requestId = 'b6d51f74-6dbb-4ff6-8b88-8a71ce100f2a';
const base = { requestId, displayName: 'Platform', loginMode: 'switch' };
const publicUser = (user: any) => ({ id: user._id, username: user.username, displayName: user.displayName });
mock.module(new URL('./users.ts', import.meta.url).href, { namedExports: {
  findUserById: async (id: string) => users.get(id) ?? null,
  findUserByUsername: async (username: string) => [...users.values()].find(user => user.username === username) ?? null,
  findUsersByIds: async () => [], setCharacterIdentity: async () => {},
  toPublicUser: publicUser, toPublicUserWithStorage: async (user: any) => publicUser(user), updateUserProfile: async () => {}
} });
mock.module(new URL('./passwords.ts', import.meta.url).href, { namedExports: { verifyPassword: async (value: string, hash: string) => value === hash } });
mock.module(new URL('./sessions.ts', import.meta.url).href, { namedExports: { revokedSessionPipeline: () => [] } });
mock.module(new URL('../subscriptions/subscriptions.ts', import.meta.url).href, { namedExports: { getSubscriptions: async () => new Map() } });
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getSessionsCollection: async () => ({}),
  getHomeThingsCollection: async () => ({
    findOne: async (match: any) => {
      const row = receipts.get(match.shareId);
      return row?.ownerId === match.ownerId ? row : null;
    },
    insertOne: async (row: any, { session }: any) => {
      assert.equal(row.thingtime[0], 'account-link');
      assert.ok(row.acl.length);
      if (receipts.has(row.shareId)) throw Object.assign(new Error('Duplicate receipt'), { code: 11000 });
      receipts.set(row.shareId, row);
      session.receipts.push(row.shareId);
    }
  })
} });
mock.module(new URL('./registerUser.ts', import.meta.url).href, { namedExports: {
  createUserAccount: async (input: any) => {
    registrations.push(input);
    // Canonical registration owns all username uniqueness/admin reservation.
    if (input.username === 'reserved-admin' || [...users.values()].some(user => user.username === input.username)) return { ok: false, status: 409, error: 'Username already taken' };
    const user = { _id: `user-${++sequence}`, username: input.username, displayName: input.displayName, passwordHash: input.password, meta: { character: input.character } };
    const session = { receipts: [] as string[] };
    try { await input.onCreated(user, session); }
    catch (error: any) {
      for (const id of session.receipts) receipts.delete(id);
      if (error.code === 11000) return { ok: false, status: 409, error: 'Username already registered' };
      throw error;
    }
    users.set(user._id, user);
    return { ok: true, user };
  }
} });
const { createCharacter } = await import('./characters.ts');
beforeEach(() => { users = new Map(); receipts = new Map(); registrations = []; sequence = 0; });

test('optional handle normalization keeps ACL and profile-path syntax unambiguous without a count cap', () => {
  assert.equal(normalizeCharacterUsername(undefined), '');
  assert.equal(normalizeCharacterUsername('   '), '');
  assert.equal(normalizeCharacterUsername(' Thingtime-Platform._1 '), 'thingtime-platform._1');
  assert.equal(normalizeCharacterUsername('a'.repeat(10000)), 'a'.repeat(10000));
  for (const input of ['someone/write', 'a?b', 'a#b', 'a b', '@name', '.name', 'a\\b', {}, null, 1]) assert.equal(normalizeCharacterUsername(input), null);
});

test('chosen handles pass through canonical registration and reuse the private transactional roster receipt', async () => {
  const input = { ...base, username: ' Thingtime-Platform ' };
  const first = await createCharacter(owner, input);
  assert.equal(first.ok, true);
  assert.equal(first.character.user.username, 'thingtime-platform');
  assert.equal(registrations[0].emailOptional, true);
  assert.equal(registrations[0].character.ownerId, 'owner');
  assert.equal(receipts.size, 1);
  const row = [...receipts.values()][0];
  assert.equal(row.crystal.linkKind, 'character');
  assert.equal(row.crystal.targetId, first.character.user.id);
  assert.equal(row.ownerId, 'owner');
  assert.deepEqual(await createCharacter(owner, { ...input, requestId: requestId.toUpperCase(), username: 'thingtime-platform' }), first);
  assert.equal(registrations.length, 1);
  for (const patch of [{ username: 'another-platform' }, { displayName: 'Another' }, { loginMode: 'inherit' }]) {
    assert.equal((await createCharacter(owner, { ...input, ...patch })).status, 409);
  }
  assert.equal(users.size, 1);
});

test('generated handles and pre-receipt legacy creations remain compatible', async () => {
  const created = await createCharacter(owner, base);
  assert.equal(created.character.user.username, `character-${requestId}`);
  receipts.clear();
  assert.deepEqual(await createCharacter(owner, base), created);
  assert.equal((await createCharacter(owner, { ...base, username: 'changed-after-legacy' })).status, 409);
  assert.equal(users.size, 1);
});

test('same request raced with different chosen handles creates only one Character', async () => {
  const results = await Promise.all([
    createCharacter(owner, { ...base, username: 'first-handle' }),
    createCharacter(owner, { ...base, username: 'second-handle' })
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 1);
  assert.equal(users.size, 1);
  assert.equal(receipts.size, 1);
});

test('same immutable request raced concurrently returns one saved Character', async () => {
  const results = await Promise.all([
    createCharacter(owner, { ...base, username: 'same-handle' }),
    createCharacter(owner, { ...base, username: 'same-handle' })
  ]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(results[0].character.user.id, results[1].character.user.id);
  assert.equal(users.size, 1);
});

test('existing or reserved handles fail without retry loops or extra ownership', async () => {
  users.set('unrelated', { _id: 'unrelated', username: 'taken', meta: {} });
  for (const username of ['taken', 'reserved-admin']) {
    const count = registrations.length;
    assert.equal((await createCharacter(owner, { ...base, username })).status, 409);
    assert.equal(registrations.length, count + 1);
  }
  assert.equal(receipts.size, 0);
  assert.equal((await createCharacter(owner, { ...base, username: 'someone/write' })).status, 400);
  assert.equal((await createCharacter({ ...owner, _id: 'stranger' }, { ...base, username: 'taken' })).status, 409);
});

test('separate-password retry verifies the original password without storing it in the receipt', async () => {
  const input = { ...base, username: 'agent', loginMode: 'password', password: 'synthetic-password' };
  assert.equal((await createCharacter(owner, input)).ok, true);
  assert.equal((await createCharacter(owner, input)).ok, true);
  assert.equal((await createCharacter(owner, { ...input, password: 'changed-password' })).status, 409);
  assert.equal(JSON.stringify([...receipts.values()]).includes(input.password), false);
  assert.equal((await createCharacter({ ...owner, _id: 'stranger' }, input)).status, 409);
});
