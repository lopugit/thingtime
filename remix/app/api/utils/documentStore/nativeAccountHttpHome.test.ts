import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionProvider } from './collectionProvider';
import { openSqliteDocumentStore } from './sqliteStore';
import { createNativeAccountHttpHome } from './nativeAccountHttpHome';
import { NATIVE_HOME_HOST_KEY } from './nativeHomeSelection';
import { getBoundThingsPersistence, withBoundTimelineRead } from '../things/persistenceContext';
import type { ThingsPersistence } from '../things/persistence';
import { registerUser } from '../auth/registerUser';
import { action as register } from '~/routes/api/v1/auth/register/_register';
import { action as login } from '~/routes/api/v1/login/_login';
import { action as logout } from '~/routes/api/v1/auth/logout/_logout';
import { loader as me } from '~/routes/api/v1/auth/me/_me';
import { loader as accounts } from '~/routes/api/v1/auth/accounts/_accounts';
import { loader as verify } from '~/routes/api/v1/auth/verify-email/_verify-email';
import { loader as notifications } from '~/routes/api/v1/notifications/_notifications';
import { action as markRead } from '~/routes/api/v1/notifications/read/_read';

const origin = 'http://127.0.0.1:18637';
const credentials = (username: string) => ({ username, email: `${username}@example.invalid`, password: 'Disposable test password only' });
const fixture = async (t: TestContext) => {
 const directory = await mkdtemp(join(tmpdir(), 'thingtime-native-account-http-'));
 const vaultKey = randomBytes(32), outboxKey = randomBytes(32);
 const changes = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: randomBytes(32).toString('base64url'),
  THINGTIME_USER_VAULT_KEY: vaultKey.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '',
  MONGODB_URI: 'mongodb://127.0.0.1:1/never-contact-this', EMAIL_PROVIDER: 'console' };
 const before = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
 Object.assign(process.env, changes);
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: undefined });
 const opened: { close(): Promise<void> }[] = [];
 t.after(async () => {
  await Promise.all(opened.map(f => f.close()));
  Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  vaultKey.fill(0); outboxKey.fill(0); await rm(directory, { recursive: true, force: true });
 });
 return async (file = 'home.sqlite') => {
  const provider = createCollectionProvider(await openSqliteDocumentStore(join(directory, file)));
  const home = await createNativeAccountHttpHome({ provider, homePlaneId: 'test-home', keyId: 'test-key', vaultKey, outboxKey });
  const f = { ...home, close: async () => { home.close(); await provider.close(); } }; opened.push(f); return f;
 };
};
const request = (path: string, cookie = '', body?: unknown) => new Request(origin + '/api/' + path, {
 method: body === undefined ? 'GET' : 'POST', headers: { cookie, 'content-type': 'application/json', origin },
 ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
const cookies = (response: Response) => response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');

test('canonical account routes create, verify, reopen, log in and revoke with actual SQLite and no Mongo authority', async t => {
 const open = await fixture(t); let home = await open();
 const call = (handler: (input: { request: Request }) => Promise<Response>, req: Request) => home.run(() => handler({ request: req }));
 const signup = await call(register, request('v1/auth/register', '', { ...credentials('native-http'), meta: { admin: true, publicUploads: true } }));
 assert.equal(signup.status, 200); const created = await signup.json(); assert.equal(created.ok, true);
 assert.deepEqual(created.verificationDelivery, { status: 'queued', delivered: false });
 assert.equal(created.user.storage.status, 'ready'); assert.equal(created.user.emailVerified, false);
 assert.notEqual(created.user.meta?.admin, true); assert.notEqual(created.user.meta?.publicUploads, true);
 const cookie = cookies(signup), id = created.user.id;
 assert.equal(cookie.includes('tt_auth='), true); assert.equal(cookie.includes('tt_accounts='), true);
 const verification = new Request(created.verificationLink);
 assert.equal(new URL(verification.url).origin, origin);
 assert.match((await call(verify, verification)).headers.get('location') || '', /verify=success/);
 assert.match((await call(verify, verification)).headers.get('location') || '', /verify=used/);
 assert.equal((await (await call(me, request('v1/auth/me', cookie))).json()).user.emailVerified, true);
 const roster = await (await call(accounts, request('v1/auth/accounts', cookie))).json();
 assert.equal(roster.accounts.length, 1); assert.equal(roster.accounts[0].user.id, id); assert.equal(roster.accounts[0].active, true);
 const history = await (await call(notifications, request('v1/notifications?history=1', cookie))).json();
 assert.equal(history.notifications.length, 1); assert.equal(history.notifications[0].title, 'Account created successfully ✨');
 const marked = await call(markRead, request('v1/notifications/read', cookie, { all: true }));
 assert.equal(marked.status, 200); assert.equal((await marked.json()).updated, 1);
 await home.close(); home = await open();
 assert.equal((await (await call(me, request('v1/auth/me', cookie))).json()).user.id, id);
 assert.equal((await (await call(notifications, request('v1/notifications?history=1', cookie))).json()).historyUnreadCount, 0);
 const wrong = await call(login, request('v1/login', '', { ...credentials('native-http'), password: 'wrong' })); assert.equal(wrong.status, 401);
 const signedIn = await call(login, request('v1/login', '', credentials('native-http'))); assert.equal(signedIn.status, 200);
 const loginCookie = cookies(signedIn); assert.equal((await signedIn.json()).user.id, id);
 assert.equal((await call(logout, request('v1/auth/logout', loginCookie, {}))).status, 200);
 assert.equal((await (await call(me, request('v1/auth/me', loginCookie))).json()).user, null);
 // Revoking the new login does not revoke the original browser session.
 assert.equal((await (await call(me, request('v1/auth/me', cookie))).json()).user.id, id);
 const foreign = await open('foreign.sqlite');
 await assert.rejects(foreign.run(() => me({ request: request('v1/auth/me', cookie) })));
});

test('native registration refuses invitations, preserves OTP enforcement and does not advertise unimplemented operations', async t => {
 const open = await fixture(t), home = await open();
 await home.run(async () => {
  const invite = await registerUser({ ...credentials('unsupported-invite'), inviteToken: 'synthetic' });
  assert.equal(invite.ok, false); if (!invite.ok) assert.equal(invite.status, 503);
  const created = await registerUser({ ...credentials('two-factor-user'), meta: { twoFactorEmailEnabled: true }, origin });
  assert.equal(created.ok, true);
  const response = await login({ request: request('v1/login', '', credentials('two-factor-user')) });
  assert.equal(response.status, 503); assert.deepEqual(response.headers.getSetCookie(), []);
  const challenge = await login({ request: request('v1/login', '', { challenge: 'foreign-otp', code: '123456' }) });
  assert.equal(challenge.status, 503); assert.deepEqual(challenge.headers.getSetCookie(), []);
 });
 assert.equal(home.supportedOperations.some(op => op.path === 'v1/root-data' || op.path === 'v1/things' || op.path === 'v1/auth/temporary'), false);
 home.close(); assert.throws(() => home.run(() => true));
});

test('protected account bootstrap binds semantic content and readonly Timeline without enabling generic HTTP routes', async t => {
 const open = await fixture(t), home = await open(); let cached!: ThingsPersistence, id = '';
 await home.run(async () => {
  const created = await registerUser({ ...credentials('content-context'), origin });
  assert.equal(created.ok, true); if (!created.ok) throw Error('Expected synthetic native account');
  id = created.user.id; cached = getBoundThingsPersistence(id)!;
  assert.equal(cached.scope.ownerId, id); assert.equal(cached.scope.homePlaneId, 'test-home');
  assert.equal((await getBoundThingsPersistence(null)!.readExact(id))?.ownerId, id);
  await withBoundTimelineRead(id, async port => assert.equal(await port.recordByIdentity('no-receipt'), null));
 });
 await assert.rejects(cached.readExact(id), /request scope/);
 assert.throws(() => getBoundThingsPersistence(id), /request scope/);
 assert.equal(home.supportedOperations.some(op => op.path === 'v1/things'), false);
 const foreign = await open('foreign-content.sqlite');
 await assert.rejects(foreign.run(() => cached.readExact(id)), /request scope/);
 await home.run(async () => assert.equal((await getBoundThingsPersistence(null)!.readExact(id))?.ownerId, id));
});
