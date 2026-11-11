import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { H3 } from 'nitro/h3';
import { MongoClient } from 'mongodb';
import { NATIVE_HOME_HOST_KEY } from '../../app/api/utils/documentStore/nativeHomeSelection';
import { getNativeHomeRuntime, closeNativeHomeRuntime } from './nativeHomeRuntime';
import handleApi from '../routes/api/[...]';

test('real Nitro dispatcher uses protected SQLite composition for canonical registration/login/session/roster and actor preconditions', async t => {
 const root = await mkdtemp(join(tmpdir(), 'thingtime-native-dispatch-'));
 const jwt = randomBytes(32), vault = randomBytes(32), outbox = randomBytes(32), id = randomUUID(), origin = 'http://127.0.0.1:29481';
 const changes = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: jwt.toString('base64url'), JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '',
  THINGTIME_USER_VAULT_KEY: vault.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', THINGTIME_DESKTOP_API_MODE: 'local',
  MONGODB_CONNECTION_STRING: 'mongodb://never.invalid/thingtime', THINGTIME_API_FALLBACK_ORIGIN: 'https://never.invalid', EMAIL_PROVIDER: 'console' };
 const before = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]])); Object.assign(process.env, changes);
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: {
  format: 1, provider: 'sqlite', profileId: id, homePlaneId: 'native-sqlite:' + id, keyId: randomUUID(), origin,
  sqliteFile: join(root, 'home.sqlite'), protectedKeys: () => ({ jwt, vault, outbox })
 } });
 t.after(async () => {
  await closeNativeHomeRuntime(); Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  for (const [key,value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  jwt.fill(0); vault.fill(0); outbox.fill(0); await rm(root, { recursive: true, force: true });
 });
 let attempts = 0; t.mock.method(MongoClient.prototype, 'connect', async function () { attempts++; throw Error('Mongo must remain fenced'); });
 const app = new H3(); app.all('/api/**', handleApi);
 let cookie = '';
 const api = async (path: string, body?: unknown, extra: Record<string,string> = {}) => app.fetch(new Request(origin + '/api/' + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...extra },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
 }));
 const credentials = { username: 'native-dispatch', email: 'native-dispatch@example.invalid', password: randomBytes(24).toString('base64url') };
 const created = await api('v1/auth/register', credentials); assert.equal(created.status, 200);
 const signup = await created.json(); assert.equal(signup.ok, true); assert.deepEqual(signup.verificationDelivery, { status: 'queued', delivered: false });
 cookie = created.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); assert.ok(cookie);
 const userId = signup.user.id;
 assert.equal((await (await api('v1/auth/me')).json()).user.id, userId);
 assert.equal((await (await api('v1/auth/accounts')).json()).accounts[0].user.id, userId);
 assert.equal((await api('v1/auth/me', undefined, { 'X-Thingtime-Expected-Actor': 'other-account' })).status, 409);
 assert.equal((await api('v1/auth/me', undefined, { 'X-Thingtime-Expected-Data-Plane': 'home' })).status, 409);
 const runtime = await getNativeHomeRuntime(); assert.equal(runtime!.snapshot().ready, true);
 // Exercise the fixture against the two actual canonical generator shapes.
 const { assertNativeManifest } = createRequire(import.meta.url)('../../../electron/scripts/test-bundled-sqlite-account.cjs');
 const { createApiCapabilitiesManifest } = await import('../../app/docs/apiDocs');
 const { thingtimeCapabilityManifest } = await import('../../app/api/utils/capabilities/thingtimeCapabilities');
 const snapshot = runtime!.snapshot();
 const wellKnown = thingtimeCapabilityManifest(origin, snapshot), flat = createApiCapabilitiesManifest([], null, snapshot);
 assert.equal(Object.prototype.hasOwnProperty.call(flat, 'origin'), false);
 assertNativeManifest(wellKnown, { expectedOrigin: origin, responseUrl: origin + '/.well-known/thingtime-capabilities.json' });
 assertNativeManifest(flat, { kind: 'flat', expectedOrigin: origin, responseUrl: origin + '/api/v1/capabilities' });
 assert.equal((await api('v1/auth/me', undefined, { 'X-Thingtime-Expected-Data-Plane': runtime!.publicDataPlane })).status, 200);
 assert.equal((await api('v1/auth/me', undefined, { 'X-Thingtime-Background-Id': 'synthetic-background' })).status, 503);
 assert.equal((await api('v1/things')).status, 503);
 assert.equal((await api('v1/auth/logout', {})).status, 200);
 assert.equal((await (await api('v1/auth/me')).json()).user, null);
 const loggedIn = await api('v1/login', credentials); assert.equal(loggedIn.status, 200); assert.equal((await loggedIn.json()).user.id, userId);
 assert.equal(attempts, 0);
});
