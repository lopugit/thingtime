import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionProvider } from '../documentStore/collectionProvider';
import { openSqliteDocumentStore } from '../documentStore/sqliteStore';
import { createNativeHomeAuthRepositories } from '../documentStore/nativeUserIdentities';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { contentDataPlane } from './contentDataPlane';
import { createNativeThingsPersistenceContext, getBoundNativeContentDataPlane } from './persistenceContext';

const publicDataPlane = 'custom-' + 'b'.repeat(64);
async function fixture(t: TestContext, identity: string | undefined = publicDataPlane) {
 const directory = await mkdtemp(join(tmpdir(), 'tt-content-plane-'));
 const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, 'private-home.sqlite')));
 const auth = await createNativeHomeAuthRepositories(provider, 'private-native-home');
 const context = createNativeThingsPersistenceContext(provider, 'private-native-home', identity);
 t.after(async () => { context.close(); await provider.close(); await rm(directory, { recursive: true, force: true }); });
 return { provider, auth, context, run: <T>(work: () => T | Promise<T>) => auth.run(() => context.run(work)) };
}

test('public content identity comes from the protected native binding and never from its private plane', async t => {
 const f = await fixture(t);
 await f.run(() => { assert.equal(contentDataPlane(), publicDataPlane); assert.equal(getBoundNativeContentDataPlane(), publicDataPlane); assert.notEqual(contentDataPlane(), 'private-native-home'); });
 const other = createNativeThingsPersistenceContext(f.provider, 'private-native-home', 'custom-' + 'c'.repeat(64));
 try { await f.auth.run(() => other.run(() => assert.equal(contentDataPlane(), 'custom-' + 'c'.repeat(64)))); } finally { other.close(); }
});

test('missing and malformed native public identities fail closed instead of returning the Mongo plane', async t => {
 const f = await fixture(t);
 for (const invalid of ['home', 'private-native-home', 'custom-bad', 'custom-' + 'F'.repeat(64), null, 42]) assert.throws(() => createNativeThingsPersistenceContext(f.provider, 'private-native-home', invalid as string), /invalid native public database identity/);
 const missing = createNativeThingsPersistenceContext(f.provider, 'private-native-home');
 try { await assert.rejects(f.auth.run(() => missing.run(() => contentDataPlane())), /public database identity is unavailable/); } finally { missing.close(); }
 const previous = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 try { assert.throws(() => contentDataPlane(), /request scope/); } finally { if (previous) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, previous); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY); }
 await assert.rejects(f.auth.run(() => Promise.resolve(contentDataPlane())), /request scope/);
});

test('escaped or closed native identity scopes cannot reuse the public identity', async t => {
 const f = await fixture(t); let release!: () => void, escaped!: Promise<string>;
 const gate = new Promise<void>(resolve => { release = resolve; });
 await f.run(() => { escaped = (async () => { await gate; return contentDataPlane(); })(); });
 release(); await assert.rejects(escaped, /request scope/);
 await assert.rejects(f.run(() => { f.context.close(); assert.throws(() => contentDataPlane(), /request scope/); }), /request scope/);
});

test('hosted content retains the existing Mongo public plane without a native selection', () => {
 assert.equal(getBoundNativeContentDataPlane(), null);
 assert.equal(contentDataPlane(), 'home');
});
