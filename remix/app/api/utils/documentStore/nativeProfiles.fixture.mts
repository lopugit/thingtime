import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import * as originals from '../mongodb/collections.ts';

let mongoCalls = 0, allowMongo = false;
const mongoQueries: { store: string; filter: any; projection?: any }[] = [];
const nativeForbidden = () => { mongoCalls++; throw new Error('Native projection attempted Mongo access'); };
const rows: Record<string, any[]> = { home: [], legacy: [] };
const store = (name: string) => {
 if (!allowMongo) return nativeForbidden();
 return { find(filter: any) {
  const call: { store: string; filter: any; projection?: any } = { store: name, filter };
  mongoQueries.push(call);
  return { project(projection: any) { call.projection = projection; return this; }, async toArray() { return rows[name]; } };
 } };
};
const forbidden = Object.fromEntries(Object.entries(originals)
 .filter(([name, value]) => typeof value === 'function' && (/^get.*Collection$/.test(name) || /Mongo.*Transaction/.test(name)))
 .map(([name]) => [name, nativeForbidden]));
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { defaultExport: {}, namedExports: {
 ...originals, ...forbidden,
 getHomeThingsCollection: async () => store('home'),
 getUsersCollection: async () => store('legacy')
} });

const { createNativeHomeAuthRepositories } = await import('./nativeUserIdentities.ts');
const { createCollectionProvider } = await import('./collectionProvider.ts');
const { openSqliteDocumentStore } = await import('./sqliteStore.ts');
const { insertUser, toBin } = await import('../auth/users.ts');
const { resolveProfiles } = await import('../things/things.ts');
const { readBoundNativeTransactionProfiles } = await import('../things/persistenceContext.ts');
const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-profiles-'));
const providers: ReturnType<typeof createCollectionProvider>[] = [];
let transactions = 0;
const open = async (file = 'home.sqlite') => {
 const actual = createCollectionProvider(await openSqliteDocumentStore(join(directory, file)));
 providers.push(actual);
 const provider = { transaction<T>(work: Parameters<typeof actual.transaction<T>>[0]) { transactions++; return actual.transaction(work); }, close: () => actual.close() };
 return { provider, ...await createNativeHomeAuthRepositories(provider, 'profile-home') };
};
const user = (username: string, temporary = false) => ({ username, ttid: username,
 email: `${username}@example.invalid`, passwordHash: 'synthetic-not-a-credential', displayName: 'Editable author',
 emailVerified: false, createdAt: new Date('2026-11-12T00:00:00Z'), updatedAt: new Date('2026-11-12T00:00:00Z'),
 meta: { temporary, privateMarker: 'never-in-a-public-author' }
});
try {
 const a = await open(); let id = '', temporaryId = '';
 await a.run(async () => {
  id = String((await insertUser(user('native-author')))._id);
  temporaryId = String((await insertUser(user('temporary-author', true)))._id);
  transactions = 0;
  assert.equal(readBoundNativeTransactionProfiles([id]), null, 'identity-only projection retains its supported repository path');
  const profiles = await resolveProfiles([id, temporaryId, id, 'missing', '000000000000000000000000']);
  assert.equal(transactions, 1); assert.equal(profiles.size, 2);
  assert.deepEqual(profiles.get(id), { id, username: 'native-author', displayName: 'Editable author', temporary: false, avatarUrl: null });
  assert.equal(profiles.get(temporaryId)?.temporary, true);
  assert.notEqual(profiles.get(temporaryId)?.displayName, 'Editable author');
  assert.doesNotMatch(JSON.stringify([...profiles.values()]), /privateMarker|passwordHash|example.invalid|secure|never-in-a-public-author/);
  transactions = 0; assert.equal((await resolveProfiles([])).size, 0); assert.equal(transactions, 0);
 });
 assert.equal(mongoCalls, 0); // Missing even-valid ObjectIds never borrow legacy Mongo.
 await a.provider.close();
 const reopened = await open();
 await reopened.run(async () => assert.equal((await resolveProfiles([id])).get(id)?.username, 'native-author'));
 const foreign = await open('other.sqlite');
 await foreign.run(async () => assert.equal((await resolveProfiles([id])).size, 0));
 let release!: () => void, pending!: Promise<unknown>;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await reopened.run(() => { pending = gate.then(() => resolveProfiles([id])); });
 const rejected = assert.rejects(pending, (error: any) => error.code === 'USER_IDENTITY_SCOPE');
 release(); await rejected; assert.equal(mongoCalls, 0);

 // The normal dual-era Mongo path keeps projection fields and Things precedence.
 allowMongo = true;
 const modern = new ObjectId().toHexString(), legacy = new ObjectId();
 rows.home = [{ shareId: modern, crystal: { username: 'modern', displayName: 'Modern' }, secure: toBin(JSON.stringify({ meta: {} })) }];
 rows.legacy = [{ _id: legacy, username: 'legacy', displayName: 'Legacy', meta: {} }];
 const profiles = await resolveProfiles([modern, legacy.toHexString(), modern, 'invalid-legacy-id']);
 assert.equal(profiles.get(modern)?.username, 'modern'); assert.equal(profiles.get(legacy.toHexString())?.username, 'legacy');
 assert.deepEqual(mongoQueries.map(call => call.store), ['home', 'legacy']);
 assert.deepEqual(mongoQueries[1].filter, { _id: { $in: [legacy] } });
 assert.equal(mongoQueries[0].projection.secure, 1); assert.equal(mongoQueries[0].projection['crystal.username'], 1);
 assert.equal(mongoQueries[1].projection.username, 1);
 console.log('native-profile-projection: 6 checks passed');
} finally {
 await Promise.all(providers.map(provider => provider.close()));
 await rm(directory, { recursive: true, force: true });
}
