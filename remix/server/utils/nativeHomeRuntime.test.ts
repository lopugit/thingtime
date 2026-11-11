import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createNativeHomeRuntime, type NativeHomeComposer } from './nativeHomeRuntime';
import { EXPECTED_DATA_PLANE_HEADER } from '../../app/utils/dataPlane';

const fixture = async (t: TestContext) => {
 const root = await mkdtemp(join(tmpdir(), 'thingtime-native-bootstrap-'));
 t.after(() => rm(root, { recursive: true, force: true }));
 const jwt = randomBytes(32), vault = randomBytes(32), outbox = randomBytes(32), profileId = randomUUID();
 const value = { format: 1, provider: 'sqlite', profileId, homePlaneId: 'native-sqlite:' + profileId, keyId: randomUUID(),
  origin: 'http://127.0.0.1:29481', sqliteFile: join(root, 'home.sqlite'),
  protectedKeys: () => ({ jwt, vault, outbox }) };
 const env = { JWT_SECRET: jwt.toString('base64url'), THINGTIME_USER_VAULT_KEY: vault.toString('base64url') };
 const compose: NativeHomeComposer = async input => {
  assert.equal(input.homePlaneId, value.homePlaneId); assert.equal(input.keyId, value.keyId);
  assert.deepEqual(input.vaultKey, vault); assert.deepEqual(input.outboxKey, outbox);
  return { run: async work => work(), supportedOperations: [{ method: 'GET', path: 'v1/auth/me' }] };
 };
 return { root, value, env, compose };
};
const code = (expected: string) => (error: any) => error.code === expected;
test('protected SQLite bootstrap pins keys/profile/file, reopens and reports only tested operation readiness', async t => {
 const f = await fixture(t), first = await createNativeHomeRuntime(f.value, f.compose, f.env);
 assert.deepEqual(first.snapshot(), { provider: 'sqlite', ready: true, supportedOperations: [{ method: 'GET', path: 'v1/auth/me' }] });
 assert.match(first.publicDataPlane, /^custom-[a-f0-9]{64}$/);
 const serialized = JSON.stringify(first.snapshot());
 for (const value of [f.value.sqliteFile, f.env.JWT_SECRET, f.env.THINGTIME_USER_VAULT_KEY, f.value.keyId]) assert.equal(serialized.includes(value), false);
 await first.close();
 const second = await createNativeHomeRuntime(f.value, f.compose, f.env);
 assert.equal(second.publicDataPlane, first.publicDataPlane); await second.close();
 for (const value of [
  { ...f.value, keyId: randomUUID() }, { ...f.value, profileId: randomUUID() },
  { ...f.value, protectedKeys: () => ({ ...f.value.protectedKeys(), outbox: randomBytes(32) }) }
 ]) await assert.rejects(createNativeHomeRuntime(value, f.compose, f.env), code('NATIVE_HOME_UNAVAILABLE'));
});
test('malformed selection, missing/mismatched protected keys, symlinks and populated foreign files refuse before composition', async t => {
 const f = await fixture(t); let calls = 0;
 const compose: NativeHomeComposer = async () => { calls++; throw Error('must not compose'); };
 for (const value of [null, { ...f.value, provider: 'mongodb' }, { ...f.value, origin: 'https://remote.invalid' },
  { ...f.value, get profileId() { throw Error('must not invoke accessor'); } }, new Proxy(f.value, {})])
  await assert.rejects(createNativeHomeRuntime(value, compose, f.env), code('NATIVE_HOME_UNAVAILABLE'));
 for (const env of [{}, { ...f.env, JWT_SECRET: randomBytes(32).toString('base64url') }, { ...f.env, JWT_PRIVATE_KEY: 'synthetic-conflict' }, { ...f.env, THINGTIME_DESKTOP_API_MODE: 'remote' }])
  await assert.rejects(createNativeHomeRuntime(f.value, compose, env), code('NATIVE_HOME_UNAVAILABLE'));
 const foreign = join(f.root, 'foreign.sqlite'); await writeFile(foreign, 'foreign bytes');
 await assert.rejects(createNativeHomeRuntime({ ...f.value, sqliteFile: foreign }, compose, f.env), code('NATIVE_HOME_UNAVAILABLE'));
 const linked = join(f.root, 'linked.sqlite'); await symlink(foreign, linked);
 await assert.rejects(createNativeHomeRuntime({ ...f.value, sqliteFile: linked }, compose, f.env), code('NATIVE_HOME_UNAVAILABLE'));
 assert.equal(calls, 0);
});
test('native operation/origin/selection preconditions refuse before handler and preserve expected-plane semantics', async t => {
 const f = await fixture(t), runtime = await createNativeHomeRuntime(f.value, f.compose, f.env); t.after(() => runtime.close());
 let calls = 0; const handler = async () => { calls++; return Response.json({ ok: true }); };
 const operation = { method: 'GET', path: 'v1/auth/me' };
 const request = (headers = {}, origin = f.value.origin) => new Request(origin + '/api/v1/auth/me', { headers });
 assert.equal((await runtime.dispatch(request(), { method: 'POST', path: 'v1/things' }, handler)).status, 503);
 assert.equal((await runtime.dispatch(request({}, 'https://remote.invalid'), operation, handler)).status, 503);
 for (const headers of [{ 'x-tt-mongo-url': 'mongodb://synthetic.invalid' }, { Cookie: 'tt_mongo=synthetic' }])
  assert.equal((await runtime.dispatch(request(headers), operation, handler)).status, 503);
 assert.equal((await runtime.dispatch(request({ Origin: 'https://remote.invalid' }), operation, handler)).status, 403);
 for (const [expected, status] of [['invalid', 400], ['home', 409]] as const)
  assert.equal((await runtime.dispatch(request({ [EXPECTED_DATA_PLANE_HEADER]: expected }), operation, handler)).status, status);
 assert.equal(calls, 0);
 assert.equal((await runtime.dispatch(request({ [EXPECTED_DATA_PLANE_HEADER]: runtime.publicDataPlane }), operation, handler)).status, 200);
 assert.equal(calls, 1);
 await runtime.close(); assert.equal((await runtime.dispatch(request(), operation, handler)).status, 503);
});
test('concurrent requests enter separate async repository scopes, active shutdown refuses and errors remain sanitized', async t => {
 const f = await fixture(t), scope = new AsyncLocalStorage<number>(); let serial = 0;
 const runtime = await createNativeHomeRuntime(f.value, async () => ({
  run: async work => scope.run(++serial, work), supportedOperations: [{ method: 'GET', path: 'v1/auth/me' }]
 }), f.env); t.after(() => runtime.close());
 let entered!: () => void, finish!: () => void;
 const started = new Promise<void>(r => { entered = r; }), gate = new Promise<void>(r => { finish = r; });
 const op = { method: 'GET', path: 'v1/auth/me' }, req = () => new Request(f.value.origin + '/api/v1/auth/me');
 const pending = runtime.dispatch(req(), op, async () => { assert.equal(scope.getStore(), 1); entered(); await gate; assert.equal(scope.getStore(), 1); return Response.json({ ok: true }); });
 await started; await assert.rejects(runtime.close(), code('NATIVE_HOME_UNAVAILABLE'));
 const other = await runtime.dispatch(req(), op, async () => { assert.equal(scope.getStore(), 2); throw Error('synthetic-secret-not-for-response'); });
 assert.equal(other.status, 503); assert.equal((await other.text()).includes('synthetic-secret'), false);
 finish(); assert.equal((await pending).status, 200); assert.equal(scope.getStore(), undefined);
});

test('cross-site webmail verification navigation remains token-validated while cross-site fetch/mutations refuse', async t => {
 const f = await fixture(t), runtime = await createNativeHomeRuntime(f.value, async () => ({ run: async work => work(),
  supportedOperations: [{ method: 'GET', path: 'v1/auth/verify-email' }, { method: 'POST', path: 'v1/auth/register' }] }), f.env);
 t.after(() => runtime.close()); let called = 0;
 const handler = async () => { called++; return Response.json({ ok: false, error: 'Token validation is still required.' }, { status: 400 }); };
 const navigation = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
 const op = { method: 'GET', path: 'v1/auth/verify-email' };
 const req = (headers: Record<string,string>, method = 'GET') => new Request(f.value.origin + '/api/v1/auth/verify-email?token=synthetic', { method, headers });
 assert.equal((await runtime.dispatch(req(navigation), op, handler)).status, 400); assert.equal(called, 1);
 for (const headers of [{ ...navigation, 'sec-fetch-mode': 'cors' }, { ...navigation, 'sec-fetch-dest': 'empty' }, { ...navigation, Origin: 'https://webmail.invalid' }])
  assert.equal((await runtime.dispatch(req(headers), op, handler)).status, 403);
 assert.equal((await runtime.dispatch(req(navigation, 'POST'), { method: 'POST', path: 'v1/auth/register' }, handler)).status, 403);
 assert.equal(called, 1);
});

test('applied protected JWT/vault identity must remain pinned on every admitted request', async t => {
 const f = await fixture(t), runtime = await createNativeHomeRuntime(f.value, f.compose, f.env); t.after(() => runtime.close());
 let called = false; f.env.JWT_SECRET = randomBytes(32).toString('base64url');
 assert.equal(runtime.snapshot().ready, false);
 const response = await runtime.dispatch(new Request(f.value.origin + '/api/v1/auth/me'), { method: 'GET', path: 'v1/auth/me' }, async () => { called = true; return Response.json({ ok: true }); });
 assert.equal(response.status, 503); assert.equal(called, false);
});

test('normal disposal and failed composition validation retire the owned composition/provider/key copies exactly once', async t => {
 const f = await fixture(t); let closes = 0; let copies!: { vaultKey: Uint8Array; outboxKey: Uint8Array };
 const runtime = await createNativeHomeRuntime(f.value, async input => { copies = input; return {
  run: async work => work(), supportedOperations: [], close() { closes++; }
 }; }, f.env);
 await runtime.close(); await runtime.close(); assert.equal(closes, 1);
 assert.equal(copies.vaultKey.every(value => value === 0), true); assert.equal(copies.outboxKey.every(value => value === 0), true);
 assert.equal(f.value.protectedKeys().vault.some(value => value !== 0), true, 'Host-owned keys are not mutated by a consumer');
 await assert.rejects(createNativeHomeRuntime(f.value, async input => { copies = input; return {
  run: async work => work(), supportedOperations: [{ method: 'GET', path: 'v1/auth/me' }, { method: 'GET', path: 'v1/auth/me' }], close() { closes++; }
 }; }, f.env), code('NATIVE_HOME_UNAVAILABLE'));
 assert.equal(closes, 2); assert.equal(copies.vaultKey.every(value => value === 0), true); assert.equal(copies.outboxKey.every(value => value === 0), true);
});
