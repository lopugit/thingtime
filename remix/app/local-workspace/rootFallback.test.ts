import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalRootFallback } from './rootFallback';
import { RootDataUnavailableError } from '../utils/rootDataRecovery';
test('only a confirmed anonymous session can reopen an anonymous offline root', () => {
	const values = new Map<string, string>();
	const fallback = createLocalRootFallback({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
	const offline = new RootDataUnavailableError(true);
	assert.equal(fallback.read(offline), null);
	fallback.confirm(true); assert.equal(fallback.read(offline)?.user, null); assert.ok(fallback.read(offline));
	assert.equal(fallback.read(offline, true), null);
	assert.equal(fallback.read(new RootDataUnavailableError(false)), null);
	assert.equal(fallback.read(new Error('Invalid response')), null);
	fallback.invalidate(); assert.equal(fallback.read(offline), null);
	fallback.confirm(false); assert.equal(fallback.read(offline), null);
	assert.deepEqual([...values.values()], ['account']);
});
test('confirmed account pointer reopens only local content identity, never an authenticated profile', () => {
 const values = new Map<string, string>(), origin = 'https://thingtime.example';
 const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
 const fallback = createLocalRootFallback(storage, origin), offline = new RootDataUnavailableError(true);
 const scope = { kind: 'account', origin, ownerId: 'owner', dataPlane: 'home' } as const;
 fallback.confirm(false, { ...scope, username: 'never persist', token: 'never persist' } as any);
 assert.deepEqual(fallback.read(offline)?.offlineWorkspace, scope);
 assert.equal(fallback.read(offline)?.user, null);
 assert.deepEqual(fallback.read(offline)?.envFromCookie, {});
 assert.equal([...values.values()].join('').includes('never persist'), false);
 assert.equal(createLocalRootFallback(storage, 'https://other.example').read(offline), null);
 assert.equal(fallback.read(offline, true), null);
 fallback.invalidate(); assert.equal(fallback.read(offline), null);
 fallback.confirm(true); assert.equal(fallback.read(offline)?.offlineWorkspace, undefined);
});
test('malformed, oversized, wrong-origin and invalid-database pointers fail closed', () => {
 const key = 'thingtime:local-workspace-root:v1', origin = 'https://thingtime.example', values = new Map<string, string>();
 const fallback = createLocalRootFallback({ getItem: k => values.get(k) ?? null, setItem: (k,v) => { values.set(k,v); } }, origin);
 for (const value of ['{', JSON.stringify(['account',1,origin,'owner','mongodb://secret']), JSON.stringify(['account',1,origin,'','home']), JSON.stringify(['account',1,origin,'owner','home','extra']), 'x'.repeat(1025)]) {
  values.set(key, value); assert.equal(fallback.read(new RootDataUnavailableError(true)), null);
 }
});
