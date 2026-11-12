import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNativeHomeRuntime } from '../../../../server/utils/nativeHomeRuntime';
import { createNativeAccountHttpHome } from '../documentStore/nativeAccountHttpHome';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { action as register } from '../../../routes/api/v1/auth/register/_register';
import { loader as me } from '../../../routes/api/v1/auth/me/_me';
import { mintPatToken, listPatTokens, revokePatToken, resolveThingsActor, inspectThingsActor, revalidateThingsActor } from './patTokens';
import { currentPatSessionPersistence } from './sessionRepository';
import { getLiveSession } from './sessions';
import { getSubscription } from '../subscriptions/subscriptions';

test('registered SQLite PAT issue, exact-use consumption, scopes, revoke, isolation and runtime origin survive reopen', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-pat-'));
 const jwt = randomBytes(32), vault = randomBytes(32), outbox = randomBytes(32), origin = 'http://127.0.0.1:18638';
 const env = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: jwt.toString('base64url'), THINGTIME_USER_VAULT_KEY: vault.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '', MONGODB_URI: 'mongodb://127.0.0.1:1/forbidden-native-pat', EMAIL_PROVIDER: 'console' };
 const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])), host = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.assign(process.env, env); Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 const profileId = randomUUID();
 const profile = { format: 1, provider: 'sqlite', profileId, homePlaneId: 'native-sqlite:' + profileId, keyId: randomUUID(), origin, sqliteFile: join(directory, 'home.sqlite'), protectedKeys: () => ({ jwt, vault, outbox }) };
 let home!: Awaited<ReturnType<typeof createNativeAccountHttpHome>>;
 let provider!: Parameters<typeof createNativeAccountHttpHome>[0]['provider'];
 const compose = async (input: Parameters<typeof createNativeAccountHttpHome>[0]) => { provider = input.provider; home = await createNativeAccountHttpHome(input); return home; };
 let runtime = await createNativeHomeRuntime(profile, compose);
 t.after(async () => {
  await runtime.close(); jwt.fill(0); vault.fill(0); outbox.fill(0); await rm(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  if (host) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, host); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
 });
 const request = new Request(origin + '/api/v1/auth/register', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'native-pat-user', email: 'native-pat@example.invalid', password: 'Disposable synthetic credential only' }) });
 const response = await runtime.dispatch(request, { method: 'POST', path: 'v1/auth/register' }, () => register({ request }));
 assert.equal(response.status, 200); const ownerId = (await response.json()).user.id;
 const minted = await home.run(() => mintPatToken(ownerId, { name: 'Concurrent PAT', scopes: ['things.read'], maxUses: 3, onlyCreatedThings: true, visibility: 'private', allowGet: true }));
 assert.equal(minted.ok, true); if (!minted.ok) return;
 const bearer = (token: string, targetOrigin = origin) => new Request(origin + '/api/v1/things', { headers: { Authorization: `Bearer ${token}`, Origin: targetOrigin } });
 await home.run(async () => {
  const denied = await resolveThingsActor(bearer(minted.token), 'things.delete'); assert.equal(denied.ok, false); if (!denied.ok) assert.equal(denied.status, 403);
  assert.equal((await inspectThingsActor(bearer(minted.token), 'things.read')).ok, true);
  assert.equal((await listPatTokens(ownerId))[0].usesRemaining, 3);
 });
 const results = await Promise.all(Array.from({ length: 12 }, () => home.run(() => resolveThingsActor(bearer(minted.token), 'things.read'))));
 const allowed = results.filter(result => result.ok && result.actor.user?.id === ownerId);
 assert.equal(allowed.length, 3);
 await home.run(async () => {
  assert.equal((await listPatTokens(ownerId))[0].usesRemaining, 0);
  const result = allowed[0]; assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.actor.pat?.onlyCreatedThings, true); assert.equal(result.actor.pat?.visibility, 'private'); }
  assert.equal((await revokePatToken('foreign-owner', minted.tokenInfo.id)).ok, false);
  const revoked = await revokePatToken(ownerId, minted.tokenInfo.id); assert.equal(revoked.ok, true);
  if (revoked.ok) { assert.equal(revoked.token.status, 'revoked'); assert.notEqual(revoked.token.expiresAt, null); }
  assert.equal((await revokePatToken(ownerId, minted.tokenInfo.id)).ok, true);
 });
 const unlimited = await home.run(() => mintPatToken(ownerId, { scopes: ['things.read'] })); assert.equal(unlimited.ok, true); if (!unlimited.ok) return;
 await home.run(async () => {
  const req = bearer(unlimited.token), admitted = await resolveThingsActor(req, 'things.read'); assert.equal(admitted.ok, true);
  if (admitted.ok && admitted.actor.pat) {
   assert.equal((await revalidateThingsActor(req, 'things.read', admitted.actor.pat)).ok, true);
   assert.equal((await revalidateThingsActor(bearer(unlimited.token), 'things.read', admitted.actor.pat)).ok, false);
  }
  const cookie = new Request(origin + '/api/v1/things', { headers: { Cookie: `tt_auth=${unlimited.token}` } });
  const denied = await resolveThingsActor(cookie, 'things.read'); assert.equal(denied.ok && denied.actor.user === null, true);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => resolveThingsActor(bearer(unlimited.token), 'things.read')));
  assert.equal(attempts.every(result => result.ok && result.actor.user?.id === ownerId), true);
 });
 const wrongOrigin = new Request(origin + '/api/v1/auth/me', { headers: { Authorization: `Bearer ${unlimited.token}`, Origin: 'https://foreign.invalid' } });
 assert.equal((await runtime.dispatch(wrongOrigin, { method: 'GET', path: 'v1/auth/me' }, () => me({ request: wrongOrigin }))).status, 403);
 const foreignId = randomUUID();
 const foreignProfile = { ...profile, profileId: foreignId, homePlaneId: 'native-sqlite:' + foreignId, keyId: randomUUID(), sqliteFile: join(directory, 'foreign.sqlite') };
 let originalPat!: ReturnType<typeof currentPatSessionPersistence>;
 await home.run(() => { originalPat = currentPatSessionPersistence(); });
 let foreignHome!: Awaited<ReturnType<typeof createNativeAccountHttpHome>>;
 const foreignRuntime = await createNativeHomeRuntime(foreignProfile, async input => { foreignHome = await createNativeAccountHttpHome(input); return foreignHome; });
 try { await foreignHome.run(async () => {
  const result = await resolveThingsActor(bearer(unlimited.token), 'things.read'); assert.equal(result.ok && result.actor.user === null, true);
  assert.deepEqual(await listPatTokens(ownerId), []);
  await assert.rejects(originalPat.list(ownerId, 10), { code: 'SESSION_REPOSITORY_SCOPE' });
  await assert.rejects(home.run(() => listPatTokens(ownerId)));
 }); } finally { await foreignRuntime.close(); }
 let escaped!: ReturnType<typeof currentPatSessionPersistence>;
 await home.run(() => { escaped = currentPatSessionPersistence(); });
 await assert.rejects(escaped.list(ownerId, 10), { code: 'SESSION_REPOSITORY_SCOPE' });
 assert.throws(() => currentPatSessionPersistence(), { code: 'SESSION_REPOSITORY_SCOPE' });
 let release!: () => void, entered!: () => void, queued!: Promise<unknown>;
 const blockedUntil = new Promise<void>(resolve => { release = resolve; }), began = new Promise<void>(resolve => { entered = resolve; });
 const blocker = provider.transaction(async () => { entered(); await blockedUntil; });
 await began;
 await home.run(() => { queued = currentPatSessionPersistence().list(ownerId, 10); });
 const queuedRefusal = assert.rejects(queued);
 release(); await blocker; await queuedRefusal;
 // No host marker is needed to reject an expired native identity continuation.
 Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
 let resume!: () => void, escapedAccessor!: Promise<unknown>;
 const resumed = new Promise<void>(resolve => { resume = resolve; });
 await home.run(() => { escapedAccessor = resumed.then(() => currentPatSessionPersistence()); });
 const accessorRefusal = assert.rejects(escapedAccessor);
 resume(); await accessorRefusal;
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 const expires = await home.run(() => mintPatToken(ownerId, { scopes: ['things.read'], expiresInMs: 1 })); assert.equal(expires.ok, true);
 if (expires.ok) {
  await new Promise(resolve => setTimeout(resolve, 10));
  await home.run(async () => {
   assert.equal(await getLiveSession(expires.tokenInfo.id), null);
   assert.equal(await currentPatSessionPersistence().consume(ownerId, expires.tokenInfo.id, false, new Date(0)), false);
   assert.equal((await listPatTokens(ownerId)).some(row => row.id === expires.tokenInfo.id), false);
  });
 }
 const lastUse = await home.run(() => mintPatToken(ownerId, { scopes: ['things.read'], maxUses: 1 })); assert.equal(lastUse.ok, true);
 if (lastUse.ok) await home.run(async () => {
  const req = bearer(lastUse.token), admitted = await resolveThingsActor(req, 'things.read');
  assert.equal(admitted.ok, true);
  if (admitted.ok && admitted.actor.pat) {
   assert.equal((await revalidateThingsActor(req, 'things.read', admitted.actor.pat)).ok, true);
   assert.equal((await resolveThingsActor(bearer(lastUse.token), 'things.read')).ok, false);
   await revokePatToken(ownerId, lastUse.tokenInfo.id);
   const revoked = await revalidateThingsActor(req, 'things.read', admitted.actor.pat);
   assert.equal(revoked.ok && revoked.actor.user === null, true);
  }
 });
 const retained = await home.run(() => mintPatToken(ownerId, { scopes: ['things.read'] })); assert.equal(retained.ok, true);
 if (retained.ok) await home.run(async () => {
  // Persistence-clock coverage for the canonical 30-day revoked-PAT reap date.
  const retired = await currentPatSessionPersistence().revokeOwned(ownerId, retained.tokenInfo.id, new Date('2000-01-01T00:00:00Z'));
  assert.notEqual(retired, null);
  assert.equal((await listPatTokens(ownerId)).some(row => row.id === retained.tokenInfo.id), false);
  assert.equal(await getLiveSession(retained.tokenInfo.id), null);
 });
 const cap = await home.run(async () => (await getSubscription('user', ownerId)).effective.maxPats);
 assert.equal(typeof cap, 'number');
 if (typeof cap === 'number') {
  const active = await home.run(async () => (await listPatTokens(ownerId)).filter(row => !row.revokedAt).length);
  const raced = await Promise.all(Array.from({ length: cap + 3 }, () => home.run(() => mintPatToken(ownerId, { scopes: ['things.read'] }))));
  assert.equal(raced.filter(result => result.ok).length, cap - active);
  assert.equal(raced.filter(result => result.ok === false && result.status === 409).length, active + 3);
  await home.run(async () => assert.equal((await listPatTokens(ownerId)).filter(row => !row.revokedAt).length, cap));
 }
 await runtime.close(); runtime = await createNativeHomeRuntime(profile, compose);
 await home.run(async () => {
  const result = await resolveThingsActor(bearer(unlimited.token), 'things.read'); assert.equal(result.ok && result.actor.user?.id, ownerId);
  const listed = await listPatTokens(ownerId); assert.equal(listed.find(row => row.id === minted.tokenInfo.id)?.status, 'revoked');
 });
});
