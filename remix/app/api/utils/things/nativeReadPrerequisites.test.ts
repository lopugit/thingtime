import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BSON } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import { ownerLibraryMatch, ownerLibraryRootMatch } from './ownerLibraryQuery';
import { nativeOwnerLibraryIncludes } from './nativeOwnerLibraryQuery';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeAccountHttpHome } from '../documentStore/nativeAccountHttpHome';
import { createNativeFoundPostRepository } from '../documentStore/nativeFoundPosts';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { registerUser } from '../auth/registerUser';
import { subscriptionShareId } from '../subscriptions/subscriptionIdentity';
import { createThing, getThing, countThings, updateThing, canViewInherited, withThingLink, type ThingDoc, type Viewer } from './things';
import { getBoundThingsPersistence } from './persistenceContext';
import { currentNativeFoundPostRepository, withHomeFoundPostRepository } from './foundPostRepository';
import { rememberFoundPost, loadFoundPostsForAuthor, foundPostId, foundPostReceiptMatches, foundPostDigest } from './foundPosts';
const origin = 'http://127.0.0.1:18637', at = new Date('2026-11-12T00:00:00Z'), namespace = physicalCollectionName('things');
async function fixture(t: TestContext) {
 const directory = await mkdtemp(join(tmpdir(), 'native-read-prerequisites-')), vaultKey = randomBytes(32), outboxKey = randomBytes(32);
 const changes = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: randomBytes(32).toString('base64url'), THINGTIME_USER_VAULT_KEY: vaultKey.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '', MONGODB_URI: 'mongodb://127.0.0.1:1/native-read-no-mongo', MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/native-read-no-mongo', EMAIL_PROVIDER: 'console' };
 const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]])), descriptor = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.assign(process.env, changes); Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 const opened: { close(): Promise<void> }[] = [];
 t.after(async () => { for (const f of opened) await f.close(); if (descriptor) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, descriptor); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } vaultKey.fill(0); outboxKey.fill(0); await rm(directory, { recursive: true, force: true }); });
 const open = async (file = 'home.sqlite') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, file))), home = await createNativeAccountHttpHome({ provider, homePlaneId: 'read-home', keyId: 'test', vaultKey, outboxKey }); let closed = false;
  const close = async () => { if (!closed) { closed = true; home.close(); await provider.close(); } }; opened.push({ close });
  const register = (username: string) => home.run(async () => { const result = await registerUser({ username, email: `${username}@example.invalid`, password: 'Synthetic disposable password only', origin }); assert.equal(result.ok, true); if (!result.ok) throw new Error('Test registration failed'); return result.user; });
  return { provider, home, run: home.run, close, register,
   insert: (documents: Record<string, unknown>[]) => provider.transaction(s => { for (const doc of documents) s.collection(namespace).insert(BSON.serialize(doc)); }),
   change: (id: string, path: string[], value: unknown) => provider.transaction(s => s.collection(namespace).updateOne({ op: 'eq', path: ['shareId'], value: id }, [{ op: 'set', path, value }])) };
 }; return { open };
}
const post = (ownerId: string): ThingDoc => ({ _id: 'hidden-post', shareId: 'hidden-post', schemaVersion: 2, ownerId, thingtime: ['post'], acl: ['tt:hidden'], linkKey: 'synthetic-key', crystal: {}, tags: [], createdAt: at, updatedAt: at } as ThingDoc);
type Fixture = Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['open']>>;
const make = (f: Fixture, ownerId: string, shareId: string, extra: Record<string, unknown> = {}) => f.run(() => createThing(ownerId, { shareId, thingtime: ['data'], crystal: { label: shareId }, visibility: 'private', ...extra }, { id: ownerId }));

test('registered native Builder reads with discovery enabled are true no-ops for ordinary Things', async t => {
 const { open } = await fixture(t), f = await open(), user = await f.register('read-builder'); assert.equal((await make(f, user.id, 'ordinary', { visibility: 'public' })).ok, true);
 for (const viewer of [{ id: user.id }, null, { id: '', anonymousId: 'anonymous-synthetic' }]) assert.equal((await f.run(() => getThing(viewer, 'ordinary', null, { rememberDiscovery: true }))).ok, true);
 await f.run(async () => assert.deepEqual((await getBoundThingsPersistence(null)!.readWindow({ kinds: ['post-discovery'], limit: 10 })).documents, []));
 assert.equal(f.home.supportedOperations.some(op => op.path === 'v1/things'), false);
});

test('registered SQLite count spans batches, filters, root containment, edits and reopen', async t => {
 const { open } = await fixture(t), f = await open(), user = await f.register('read-counter'); assert.equal((await make(f, user.id, 'folder', { thingtime: ['folder'], crystal: { name: 'Folder', builderApp: true } })).ok, true);
 for (let i = 0; i < 132; i++) assert.equal((await make(f, user.id, `item-${i}`, { crystal: { parentId: i % 3 === 0 ? 'rel' : null, archived: i % 2 === 0 }, ...(i % 5 === 0 ? { folderId: 'folder' } : {}) })).ok, true);
 const count = (query = {}) => f.run(() => countThings(user.id, query));
 // Canonical History creates its ordinary folder too; the library counts it.
 assert.deepEqual(await count(), { ok: true, count: 134 }); assert.deepEqual(await count({ thingtime: ['data'], excludeArchived: true }), { ok: true, count: 66 }); assert.deepEqual(await count({ parentId: 'rel' }), { ok: true, count: 44 }); assert.deepEqual(await count({ folder: 'folder' }), { ok: true, count: 27 }); assert.deepEqual(await count({ folder: 'root', builderAppOnly: true }), { ok: true, count: 1 }); assert.deepEqual(await count({ folder: 'root', thingtime: ['data'] }), { ok: true, count: 70 });
 assert.equal((await f.run(() => updateThing(user.id, 'item-1', { crystal: { archived: true } }))).ok, true); assert.deepEqual(await count({ thingtime: ['data'], excludeArchived: true }), { ok: true, count: 65 }); await f.close(); const reopened = await open(); assert.deepEqual(await reopened.run(() => countThings(user.id, { parentId: 'rel' })), { ok: true, count: 44 });
});

test('native count enforces read-token ACLs and refuses unavailable families rather than count0', async t => {
 const { open } = await fixture(t), f = await open(), user = await f.register('read-fences'); assert.equal((await make(f, user.id, 'public', { visibility: 'public' })).ok, true); assert.equal((await make(f, user.id, 'private')).ok, true);
 const token = { id: user.id, pat: { tokenId: 'synthetic-read-token', onlyCreatedThings: false, visibility: 'public' as const } }; assert.deepEqual(await f.run(() => countThings(token, {})), { ok: true, count: 1 }); assert.equal((await f.run(() => updateThing(user.id, 'public', { acl: ['tt:user'] }))).ok, true); assert.deepEqual(await f.run(() => countThings(token, {})), { ok: true, count: 0 });
 for (const query of [{ targetId: 'missing' }, { appId: 'namespace' }, { thingtime: ['action'] }]) { const result = await f.run(() => countThings(user.id, query)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 503); }
 for (const query of [{ cursor: 'opaque' }, { limit: 1 }, { offset: 0 }, { schemaId: 'bad.id' }, { parentId: ' invalid ' }]) { const result = await f.run(() => countThings(user.id, query)); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.status, 400); }
 assert.deepEqual(await f.run(() => countThings(user.id, {}, null, { signal: AbortSignal.abort() })), { ok: false, status: 499, error: 'Things count cancelled' });
 // Protected family UNIT fixture; not canonical theme setup/HTTP acceptance.
 await f.insert([{ _id: 'managed', shareId: 'managed', ownerId: user.id, thingtime: ['theme'], acl: ['tt:user'], crystal: {}, createdAt: at, updatedAt: at }]); const unavailable = await f.run(() => countThings(user.id, {})); assert.equal(unavailable.ok, false); if (!unavailable.ok) assert.equal(unavailable.status, 503); assert.deepEqual(await f.run(() => countThings(token, {})), { ok: true, count: 0 }); const foreign = await open('foreign.sqlite'); assert.deepEqual(await foreign.run(() => countThings(user.id, { thingtime: ['data'] })), { ok: true, count: 0 });
});

test('SQLite discovery unit fixtures preserve canonical anonymous/control receipts and revisit idempotency', async t => {
 const { open } = await fixture(t), f = await open(), author = await f.register('discover-author'), reader = await f.register('discover-reader'); const saved = post(author.id); await f.insert([saved]); // Protected post UNIT fixture: native post setup unsupported.
 const viewer = withThingLink({ id: reader.id }, saved.shareId), anonymous = withThingLink({ id: '', anonymousId: 'anonymous-synthetic-browser' }, saved.shareId);
 await f.run(async () => {
  const ledger = await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', reader.id));
  for (const identity of [null, { id: reader.id }, { id: author.id }, { id: reader.id, pat: { tokenId: 'read-only', onlyCreatedThings: false } }, { id: reader.id, linkKeys: new Set(['wrong']) }]) await rememberFoundPost(identity, saved);
  assert.equal(await getBoundThingsPersistence(null)!.readExact(foundPostId(reader.id, saved.shareId)), null); await rememberFoundPost(viewer, saved, '192.0.2.7'); const receipt = await getBoundThingsPersistence(null)!.readExact(foundPostId(reader.id, saved.shareId)); assert.equal(foundPostReceiptMatches(receipt as ThingDoc, saved, reader.id), true); assert.equal(receipt!.storageClass, 'control'); assert.equal(receipt!.sizeBytes, 0); assert.equal(JSON.stringify(receipt).includes(saved.linkKey!), false);
  await rememberFoundPost(viewer, saved, '192.0.2.8'); assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(receipt!.shareId), receipt); await rememberFoundPost(anonymous, saved); assert.deepEqual([...(await loadFoundPostsForAuthor(reader.id, author.id))], [[saved.shareId, foundPostDigest(saved.linkKey!)]]); assert.equal(await canViewInherited(saved, { id: reader.id }), true); assert.equal(await canViewInherited(saved, { id: 'foreign-reader' }), false); assert.equal(await canViewInherited(saved, { id: '', anonymousId: 'anonymous-synthetic-browser' }), true); const token: Viewer = { id: reader.id, pat: { tokenId: 'read-only', onlyCreatedThings: false, visibility: 'all' } }; assert.equal(await canViewInherited(saved, token), false); assert.equal((await getThing({ id: reader.id }, receipt!.shareId)).ok, false); assert.deepEqual(await getBoundThingsPersistence(null)!.readExact(subscriptionShareId('user', reader.id)), ledger, 'control receipts never touch the content ledger');
 }); await f.close(); const reopened = await open(); await reopened.run(async () => assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 1));
});

test('native discovery revalidates rotation, private/blocked content, foreign receipts and exact provider/lifetime', async t => {
 const { open } = await fixture(t), f = await open(), author = await f.register('revocation-author'), reader = await f.register('revocation-reader'), saved = post(author.id); await f.insert([saved]); const viewer = withThingLink({ id: reader.id }, saved.shareId); await f.run(() => rememberFoundPost(viewer, saved)); await f.change(saved.shareId, ['linkKey'], 'rotated');
 await f.run(async () => { assert.equal(await canViewInherited({ ...saved, linkKey: 'rotated' }, { id: reader.id }), false); assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0); await rememberFoundPost(viewer, saved); assert.equal((await getBoundThingsPersistence(null)!.readExact(foundPostId(reader.id, saved.shareId)))!.crystal.linkKeyDigest, foundPostDigest(saved.linkKey!)); });
 await f.run(() => rememberFoundPost(viewer, { ...saved, linkKey: 'rotated' })); await f.change(saved.shareId, ['acl'], ['tt:user']); await f.run(async () => { await rememberFoundPost(viewer, { ...saved, linkKey: 'rotated' }); assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0); assert.equal(await canViewInherited({ ...saved, acl: ['tt:user'], linkKey: 'rotated' }, { id: reader.id }), false); });
 await f.change(saved.shareId, ['acl'], ['tt:all', `-tt:user/${reader.username}`]);
 await f.run(async () => {
  const denied = { ...saved, acl: ['tt:all', `-tt:user/${reader.username}`], linkKey: 'rotated' };
  assert.equal(await canViewInherited(denied, { id: reader.id, username: reader.username }), false, 'negative audience survives a historical hidden receipt');
  await rememberFoundPost(viewer, { ...saved, linkKey: 'rotated' });
  assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0);
 });
 await f.change(saved.shareId, ['acl'], ['tt:hidden']); await f.change(saved.shareId, ['moderation'], { status: 'blocked' }); await f.run(() => rememberFoundPost(withThingLink({ id: 'blocked-reader' }, saved.shareId), { ...saved, linkKey: 'rotated' })); await f.run(async () => assert.equal(await getBoundThingsPersistence(null)!.readExact(foundPostId('blocked-reader', saved.shareId)), null)); await f.change(saved.shareId, ['moderation'], null); await f.change(foundPostId(reader.id, saved.shareId), ['ownerId'], 'someone-else');
 await f.run(async () => { assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0); assert.equal(await canViewInherited({ ...saved, linkKey: 'rotated' }, { id: reader.id }), false); await assert.rejects(rememberFoundPost(viewer, { ...saved, linkKey: 'rotated' }), /collision/); });
 const foreign = await open('foreign.sqlite'); await foreign.run(async () => assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0)); const foreignRepository = await createNativeFoundPostRepository(foreign.provider, 'read-home'); await assert.rejects(f.run(() => foreignRepository.loadForAuthor(reader.id, author.id))); await assert.rejects(f.run(() => withHomeFoundPostRepository(foreignRepository, () => true))); let escaped: NonNullable<ReturnType<typeof currentNativeFoundPostRepository>>; await f.run(() => { escaped = currentNativeFoundPostRepository()!; }); await assert.rejects(escaped!.loadForAuthor(reader.id, author.id));
});


test('discovery read revalidation sees a protected post generation changed inside the exact active transaction', async t => {
 const { open } = await fixture(t), f = await open(), author = await f.register('transaction-author'), reader = await f.register('transaction-reader'), saved = post(author.id);
 await f.insert([saved]); // Protected post UNIT fixture, not native post-write acceptance.
 await f.run(() => rememberFoundPost(withThingLink({ id: reader.id }, saved.shareId), saved));
 await f.run(async () => getBoundThingsPersistence(author.id)!.transaction('write', async tx => {
  assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 1);
  const current = await tx.readExact(saved.shareId); assert.ok(current);
  assert.equal(await tx.compareAndSwap({ id: current.shareId, identity: current._id, updatedAt: current.updatedAt }, { ...current, linkKey: 'transaction-rotated', updatedAt: new Date(+current.updatedAt + 1) }), true);
  assert.equal((await loadFoundPostsForAuthor(reader.id, author.id)).size, 0);
  assert.equal(await canViewInherited({ ...saved, linkKey: 'transaction-rotated' }, { id: reader.id }), false);
 }));
});


test('registered schema-stamped Data counts retain exact schema filters and active-library authorization', async t => {
 const { open } = await fixture(t), f = await open(), user = await f.register('schema-counter');
 assert.equal((await make(f, user.id, 'count-schema', { thingtime: ['schema'], crystal: { name: 'Tasks', fields: [{ name: 'title', type: 'string' }] } })).ok, true);
 assert.equal((await make(f, user.id, 'typed', { crystal: { title: 'Editable', schemaId: 'count-schema' } })).ok, true);
 assert.equal((await make(f, user.id, 'untyped')).ok, true);
 assert.deepEqual(await f.run(() => countThings(user.id, { schemaId: 'count-schema' })), { ok: true, count: 1 });
 assert.deepEqual(await f.run(() => countThings(user.id, { schemaId: 'absent-schema' })), { ok: true, count: 0 });
 assert.deepEqual(await f.run(() => countThings(user.id, { schemaId: 'count-schema', libraryArchive: 'active' }, null, { archiveOwnerId: user.id })), { ok: true, count: 1 });
 const archive = await f.run(() => countThings(user.id, { libraryArchive: 'archived' }, null, { archiveOwnerId: user.id })); assert.equal(archive.ok, false); if (!archive.ok) assert.equal(archive.status, 503);
 const unauthorized = await f.run(() => countThings(user.id, { libraryArchive: 'active' })); assert.equal(unauthorized.ok, false); if (!unauthorized.ok) assert.equal(unauthorized.status, 403);
});

// Query evaluation belongs only in this parity test; production uses semantic
// selection and never translates arbitrary Mongo expressions into native code.
test('semantic native owner/root selection agrees with the canonical managed-family query', () => {
 const matches = (row: Record<string, any>, query: Record<string, any>): boolean => Object.entries(query).every(([key, expected]) => {
  if (key === '$and') return expected.every((part: any) => matches(row, part));
  if (key === '$or') return expected.some((part: any) => matches(row, part));
  if (key === '$expr') return row[expected.$eq[0].slice(1)] === row[expected.$eq[1].slice(1)];
  const actual = key.split('.').reduce((value, field) => value?.[field], row);
  if (expected === null) return actual == null;
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) return Object.entries(expected).every(([op, operand]) => {
   if (op === '$exists') return (actual !== undefined) === operand;
   if (op === '$ne') return !isDeepStrictEqual(actual, operand);
   if (op === '$nin') return !(operand as unknown[]).some(value => (Array.isArray(actual) ? actual : [actual]).includes(value));
   if (op === '$in') return (operand as unknown[]).some(value => value === null ? actual == null : (Array.isArray(actual) ? actual : [actual]).includes(value));
   throw new Error('Unexpected parity-test query');
  });
  return isDeepStrictEqual(actual, expected);
 });
 const excluded = ['user', 'notification', 'file', 'attachment', 'chat-archive', 'timeline-event'];
 const variants = [ {}, { thingtime: ['user'] }, { thingtime: ['data', 'user'] }, { thingtime: ['theme'] },
  { thingtime: ['file'], crystal: { trashed: false } }, { thingtime: ['file'], crystal: { trashed: true } },
  { thingtime: ['feed-algorithm'] }, { thingtime: ['custom-emoji'] }, { thingtime: ['custom-emoji'], targetId: 'parent' },
  { thingtime: ['attachment'], attachmentPurpose: 'file', attachmentState: 'ready' },
  { thingtime: ['attachment'], attachmentPurpose: 'file', attachmentState: 'ready', targetId: null },
  { thingtime: ['attachment'], attachmentPurpose: 'recording', attachmentState: 'ready', attachmentImportDraft: true },
  { thingtime: ['chat-archive'], archiveVersion: 1, archiveRootId: 'test' },
  { thingtime: ['chat-archive'], archiveVersion: 1, archiveRootId: 'foreign' },
  { folderId: 'folder' }, { parentId: 'parent' }, { targetId: 'parent' }, { crystal: { parentId: 'parent' } },
  { folderId: null, parentId: null, targetId: null, crystal: { parentId: null } }, { thingtime: ['file-sync'] } ];
 for (const extra of variants) for (const includeArchives of [false, true]) for (const root of [false, true]) {
  const row = { ownerId: 'owner', shareId: 'test', thingtime: ['data'], crystal: {}, ...extra };
  const query = { $and: [ownerLibraryMatch('owner', excluded, includeArchives), ...(root ? [ownerLibraryRootMatch()] : [])] };
  assert.equal(nativeOwnerLibraryIncludes(row, excluded, includeArchives, root), matches(row, query), JSON.stringify([extra, includeArchives, root]));
 }
});
