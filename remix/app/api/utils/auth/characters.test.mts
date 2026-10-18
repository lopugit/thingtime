import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { characterIdentity, characterSelectionAllowed } from './characterCore.ts';
let users: Record<string, any>;
let sessions: Record<string, any>;
let claims: any;
mock.module(new URL('./jwt.ts', import.meta.url).href, { namedExports: { verifyJwt: async () => claims } });
mock.module(new URL('./authCookie.ts', import.meta.url).href, { namedExports: { getAuthToken: async () => 'fixture' } });
mock.module(new URL('./sessions.ts', import.meta.url).href, { namedExports: { getLiveSession: async (id: string) => sessions[id] ?? null } });
mock.module(new URL('./users.ts', import.meta.url).href, { namedExports: {
  findUserById: async (id: string) => users[id] ?? null,
  toPublicUser: (user: any) => ({ id: user._id, username: user.username, isAdmin: user.meta?.admin === true })
} });
mock.module(new URL('../subscriptions/subscriptions.ts', import.meta.url).href, { namedExports: { getSubscription: async () => null } });
const { resolveSessionUser, getCurrentUser } = await import('./getCurrentUser.ts');
const { characterPrincipal, sessionActingUser } = await import('./characterSession.ts');
beforeEach(() => {
  users = {
    owner: { _id: 'owner', username: 'private-owner', accountKind: 'user', meta: { admin: true } },
    character: { _id: 'character', username: 'random-character', accountKind: 'user', meta: { character: { ownerId: 'owner', loginMode: 'password', disabled: false } } },
    stranger: { _id: 'stranger', accountKind: 'user', meta: {} },
    sibling: { _id: 'sibling', accountKind: 'user', meta: { character: { ownerId: 'owner', loginMode: 'switch', disabled: false } } }
  };
  sessions = { live: { jti: 'live', userId: 'owner', purpose: 'browser', meta: {} } };
  claims = { sub: 'owner', jti: 'live' };
});
test('owner sessions act as the selected Character without inheriting administrator authority or owner fields', async () => {
  sessions.live.meta.activeCharacterId = 'character';
  assert.deepEqual(await resolveSessionUser('live', 'owner', null), { id: 'character', username: 'random-character', isAdmin: false });
  assert.equal((await characterPrincipal(new Request('https://test.invalid')))?.user._id, 'owner');
});
test('per-request identity is authorized independently of the session default', async () => {
  sessions.live.meta.activeCharacterId = 'character';
  const request = (id: string) => new Request('https://test.invalid', { headers: { 'X-Thingtime-Character': id } });
  assert.equal((await getCurrentUser(request('sibling')))?.id, 'sibling');
  assert.equal((await getCurrentUser(request('owner')))?.id, 'owner');
  assert.equal(await getCurrentUser(request('stranger')), null);
  assert.equal(await getCurrentUser(request('')), null);
});
test('a Character login cannot become its owner or sibling', async () => {
  sessions.live.userId = 'character'; claims.sub = 'character';
  assert.equal((await resolveSessionUser('live', 'character'))?.id, 'character');
  assert.equal(await resolveSessionUser('live', 'character', 'owner'), null);
  assert.equal(await resolveSessionUser('live', 'character', 'sibling'), null);
});
test('disabled, orphaned and nested Characters fail closed', async () => {
  sessions.live.meta.activeCharacterId = 'character';
  users.character.meta.character.disabled = true;
  assert.equal(await resolveSessionUser('live', 'owner', null), null);
  users.character.meta.character.disabled = false;
  delete users.owner;
  assert.equal(await sessionActingUser(users.character, { meta: {} }), null);
  users.owner = { ...users.sibling, _id: 'owner' };
  assert.equal(await sessionActingUser(users.character, { meta: {} }), null);
});
test('revoked sessions, wrong subject and scoped credentials cannot select a Character', async () => {
  assert.equal(await resolveSessionUser('live', 'stranger', 'character'), null);
  for (const purpose of ['pat', 'app', 'app-sandbox', 'device-node', 'future-scope']) {
    sessions.live.purpose = purpose;
    assert.equal(await resolveSessionUser('live', 'owner', 'character'), null, purpose);
    assert.equal(await characterPrincipal(new Request('https://test.invalid')), null, purpose);
  }
  delete sessions.live;
  assert.equal(await resolveSessionUser('live', 'owner', 'character'), null);
});
test('temporary and service accounts cannot acquire proxy identities', () => {
  assert.equal(characterSelectionAllowed({ ...users.owner, meta: { temporary: true } }, users.character), false);
  assert.equal(characterSelectionAllowed({ ...users.owner, accountKind: 'service' }, users.character), false);
  assert.equal(characterIdentity({ meta: { character: { ownerId: 'owner', loginMode: 'unknown' } } }), null);
});

test('account roster resolution retains the principal after Character selection', async () => {
  sessions.live.meta.activeCharacterId = 'character';
  assert.equal((await resolveSessionUser('live', 'owner'))?.id, 'owner');
  assert.equal((await getCurrentUser(new Request('https://test.invalid')))?.id, 'character');
});
