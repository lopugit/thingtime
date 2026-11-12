import assert from 'node:assert/strict';
import test from 'node:test';
import { BSON } from 'mongodb';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeHomeRuntime } from '../../../../server/utils/nativeHomeRuntime';
import { createNativeAccountHttpHome } from '../documentStore/nativeAccountHttpHome';
import { NATIVE_HOME_HOST_KEY } from '../documentStore/nativeHomeSelection';
import { action as register } from '../../../routes/api/v1/auth/register/_register';
import { loader, action } from '../../../routes/api/v1/webpages/resolve/_resolve';
import { createThing, updateThing } from '../things/things';
import { initializeWorkspace, saveWorkspaceRecord, bindWorkspacePage, archiveWorkspaceRecord } from '../serviceWorkspaces/workspaces';
import { createSession } from '../auth/sessions';
import { signJwt } from '../auth/jwt';
import { physicalCollectionName } from '../mongodb/collectionNames';
import { mintPatToken, listPatTokens } from '../auth/patTokens';
import { getBoundThingsPersistence } from '../things/persistenceContext';
import { resolveTemplate } from '../../../components/ComponentsLibrary/componentTemplate';
import { storedComponentScope } from '../actions/sharedCompositionCore';

// Actual handlers and runtime admission; no mocked handlers or operation
// overrides. Protected system/external metadata fixtures are labeled below.
test('native runtime preserves the complete Webpage GET/POST handler contract', async t => {
 const directory = await mkdtemp(join(tmpdir(), 'tt-native-resolve-'));
 const jwt = randomBytes(32), vault = randomBytes(32), outbox = randomBytes(32), profileId = randomUUID();
 const origin = 'http://127.0.0.1:28673';
 const env = { NODE_ENV: 'development', APP_URL: origin, JWT_SECRET: jwt.toString('base64url'), JWT_PRIVATE_KEY: '', JWT_PUBLIC_KEY: '',
  THINGTIME_USER_VAULT_KEY: vault.toString('base64url'), THINGTIME_ADMIN_VAULT_KEY: '', THINGTIME_DESKTOP_API_MODE: 'local',
  MONGODB_URI: 'mongodb://127.0.0.1:1/forbidden-native-resolve', MONGODB_CONNECTION_STRING: 'mongodb://127.0.0.1:1/forbidden-native-resolve', EMAIL_PROVIDER: 'console' };
 const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
 const previousHost = Object.getOwnPropertyDescriptor(globalThis, NATIVE_HOME_HOST_KEY);
 Object.assign(process.env, env);
 const profile = { format: 1, provider: 'sqlite', profileId, homePlaneId: 'native-sqlite:' + profileId, keyId: randomUUID(), origin,
  sqliteFile: join(directory, 'home.sqlite'), protectedKeys: () => ({ jwt, vault, outbox }) };
 Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, { configurable: true, value: profile });
 let provider!: Parameters<typeof createNativeAccountHttpHome>[0]['provider'];
 let home!: Awaited<ReturnType<typeof createNativeAccountHttpHome>>;
 const runtime = await createNativeHomeRuntime(profile, async input => { provider = input.provider; home = await createNativeAccountHttpHome(input); return home; });
 t.after(async () => {
  await runtime.close(); jwt.fill(0); vault.fill(0); outbox.fill(0);
  if (previousHost) Object.defineProperty(globalThis, NATIVE_HOME_HOST_KEY, previousHost); else Reflect.deleteProperty(globalThis, NATIVE_HOME_HOST_KEY);
  for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  await rm(directory, { recursive: true, force: true });
 });
 const request = (path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => new Request(origin + '/api/' + path, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
 });
 const dispatch = (handler: typeof loader, req: Request) => runtime.dispatch(req,
  { method: req.method, path: new URL(req.url).pathname.slice('/api/'.length) }, () => handler({ request: req }));
 const invoke = (handler: typeof loader, req: Request) => home.run(() => handler({ request: req }));
 const signup = async (username: string) => {
  const response = await dispatch(register, request('v1/auth/register', '', { username, email: username + '@example.invalid', password: 'Isolated synthetic test credential only' }));
  assert.equal(response.status, 200); const data = await response.json();
  return { ...data.user, id: data.user.id as string, cookie: response.headers.getSetCookie().map(row => row.split(';')[0]).join('; ') };
 };
 const owner = await signup('native-resolve-owner'), foreign = await signup('native-resolve-foreign');
 const create = async (id: string, kind: string, crystal: Record<string, unknown>, acl = ['tt:user'], author = owner, held = false) => {
  const result = await home.run(() => createThing(author.id, { shareId: id, thingtime: [kind], crystal, acl }, { id: author.id }, null,
   held ? { executionHold: { version: 1, operationId: 'fixture-hold', completionEventId: 'fixture-completion', rootId: id, binding: 'a'.repeat(64) } } : {}));
  assert.equal(result.ok, true, JSON.stringify(result));
 };
 const text = 'Exact local text — æøå ❤️\nsecond line';
 await create('native-route-card', 'component', { name: 'Card', componentKey: 'native-route-card', version: 1,
  args: [{ name: 'label', type: 'string', default: text }], render: { tag: 'p', children: '{label}' } });
 await create('native-route-foreign', 'component', { name: 'Foreign', render: { tag: 'p', children: 'FOREIGN PRIVATE' } }, ['tt:user'], foreign);
 await create('native-route-source', 'component', { name: 'Source', render: { tag: 'p', children: 'SOURCE' } }, ['tt:all'], foreign);
 const blocks = [{ id: 'nested', type: 'container', direction: 'column', children: [
  { id: 'default', type: 'component', component: 'native-route-card' },
  { id: 'override', type: 'component', component: 'native-route-card', args: { label: 'Override text' }, source: { action: 'native-route-query', inputs: { search: '{query.search}', fallback: 'stored fallback' } } }
 ] }, { id: 'foreign', type: 'component', component: 'native-route-foreign' },
 { id: 'source', type: 'component', component: 'native-route-source' }, { id: 'missing', type: 'component', component: 'native-route-missing' }];
 for (const [id, acl] of [['public', ['tt:all']], ['hidden', ['tt:hidden', 'tt:user']], ['private', ['tt:user']]] as const)
  await create('native-route-' + id, 'webpage', { name: id, blocks }, [...acl]);
 await create('native-route-held', 'webpage', { name: 'Held', blocks }, ['tt:all'], owner, true);
 await create('native-route-clock-schema', 'schema', { name: 'Clock', fields: [{ name: 'cutoff', type: 'string' }] });
 await create('native-route-clock', 'data', { schemaId: 'native-route-clock-schema', cutoff: '04:30' });
 await create('native-route-scheduled', 'webpage', { name: 'Scheduled', blocks: [], activationAction: { action: 'native-route-inert', cadence: 'day', timeZone: 'Australia/Melbourne', cutoffTime: { thingId: 'native-route-clock', schemaId: 'native-route-clock-schema', field: 'cutoff' } } });
 await create('native-route-personal', 'webpage', { name: 'Personal', pageKey: 'native-personal', siteRoute: '/native-personal', blocks });
 await create('native-route-global', 'webpage', { name: 'Global', pageKey: 'site-global', blocks });
 // System-default lookup rows are protected catalogue unit fixtures; normal users
 // cannot author system-owned content through createThing.
 await provider.transaction(tx => { const collection = tx.collection(physicalCollectionName('things')), at = new Date();
  for (const [id, pageKey, siteRoute] of [['native-system-personal', 'native-personal', '/native-personal'], ['native-system-global', 'site-global', undefined]])
   collection.insert(BSON.serialize({ _id: id, shareId: id, ownerId: 'system', schemaVersion: 2, thingtime: ['webpage'], acl: ['tt:all'], createdAt: at, updatedAt: at, crystal: { name: id, pageKey, ...(siteRoute ? { siteRoute } : {}), blocks: [] } }));
 });
 const get = (id: string, cookie = '', extra = {}) => invoke(loader, request('v1/webpages/resolve?id=' + encodeURIComponent(id), cookie, undefined, extra));
 const preview = `v1/webpages/resolve?ownerId=${owner.id}&dataPlane=${runtime.publicDataPlane}`;
 await t.test('GET nested/repeated refs, exact defaults/override arguments and anonymous shared/hidden audience', async () => {
  for (const id of ['native-route-public', 'native-route-hidden']) for (const cookie of ['', owner.cookie, foreign.cookie]) {
   const response = await get(id, cookie); assert.equal(response.status, 200); const data = await response.json();
   assert.deepEqual(data.page.crystal.blocks[0].children[1].source, blocks[0].children![1].source);
   assert.equal(data.page.id, id); assert.equal(data.refs['native-route-card'], 'native-route-card');
   assert.equal(data.refs['native-route-foreign'], cookie === foreign.cookie ? 'native-route-foreign' : null);
   assert.equal(data.refs['native-route-missing'], null); assert.equal(data.refs['native-route-source'], 'native-route-source');
   assert.equal(data.components.filter((row: any) => row.id === 'native-route-card').length, 1);
   const component = data.components.find((row: any) => row.id === 'native-route-card');
   assert.equal((resolveTemplate(component.crystal.render, storedComponentScope(component.crystal)) as { children: unknown }).children, text);
   assert.equal((resolveTemplate(component.crystal.render, storedComponentScope(component.crystal, data.page.crystal.blocks[0].children[1].args)) as { children: unknown }).children, 'Override text');
   if (!cookie) assert.equal(JSON.stringify(data).includes('FOREIGN PRIVATE'), false);
  }
 });
 await t.test('GET private/missing/invalid and held results', async () => {
  assert.equal((await get('native-route-private')).status, 404); assert.equal((await get('native-route-private', owner.cookie)).status, 200);
  assert.equal((await get('native-route-absent')).status, 404); assert.equal((await get('$invalid')).status, 400);
  assert.equal((await invoke(loader, request('v1/webpages/resolve?path=invalid'))).status, 400);
  const held = await get('native-route-held', owner.cookie); assert.equal(held.status, 200);
  const data = await held.json(); assert.equal(data.page.executionHeld, true); assert.deepEqual(data.page.crystal.blocks, blocks); assert.ok(data.components.length > 0);
  assert.equal(data.page.executionHold, undefined, 'protected hold envelope never leaves the projection');
 });
 await t.test('POST real auth, validation, owner and protected public database identity', async () => {
  const response = await invoke(action, request(preview, owner.cookie, { blocks })); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.refs['native-route-card'], 'native-route-card'); assert.equal(data.refs['native-route-foreign'], null);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal((await invoke(action, request(preview, '', { blocks }))).status, 401);
  assert.equal((await invoke(action, request(preview.replace(owner.id, foreign.id), owner.cookie, { blocks }))).status, 409);
  assert.equal((await invoke(action, request(preview.replace(runtime.publicDataPlane, 'home'), owner.cookie, { blocks }))).status, 409);
  assert.equal((await invoke(action, request(preview, owner.cookie, { blocks: 'invalid' }))).status, 400);
  assert.equal((await invoke(action, request(preview, owner.cookie, { blocks, pageId: 'native-route-public' }))).status, 400);
 });
 await t.test('site route/page key/global selection and exact schema-backed activation cutoff remain available', async () => {
  for (const suffix of ['path=/native-personal', 'id=native-personal']) {
   const response = await invoke(loader, request('v1/webpages/resolve?' + suffix, owner.cookie)); assert.equal(response.status, 200);
   const data = await response.json(); assert.equal(data.page.id, 'native-route-personal'); assert.equal(data.source, 'user');
   const anonymous = await invoke(loader, request('v1/webpages/resolve?' + suffix));
   assert.equal(anonymous.status, 200); const fallback = await anonymous.json(); assert.equal(fallback.page.id, 'native-system-personal'); assert.equal(fallback.source, 'system');
  }
  const global = await invoke(loader, request('v1/webpages/resolve?global=1', owner.cookie)); assert.equal((await global.json()).page.id, 'native-route-global');
  assert.equal((await (await invoke(loader, request('v1/webpages/resolve?global=true'))).json()).page.id, 'native-system-global');
  const response = await get('native-route-scheduled', owner.cookie); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.activationSchedule.cutoffTime, '04:30'); assert.match(data.activationSchedule.revision, /^\d{4}-/);
  assert.equal(data.page.crystal.activationAction.action, 'native-route-inert'); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
 });
 await t.test('PATs retain canonical anonymous GET and refused POST without consuming token uses', async () => {
  const minted = await home.run(() => mintPatToken(owner.id, { scopes: ['things.read'], maxUses: 3 }));
  assert.equal(minted.ok, true); if (!minted.ok) throw Error('Expected synthetic PAT');
  const headers = { Authorization: `Bearer ${minted.token}` };
  assert.equal((await get('native-route-public', '', headers)).status, 200);
  assert.equal((await get('native-route-private', '', headers)).status, 404);
  assert.equal((await invoke(action, request(preview, '', { blocks }, headers))).status, 401);
  assert.equal((await home.run(() => listPatTokens(owner.id)))[0].usesRemaining, 3);
 });
 await t.test('app-purpose scoped sessions never become full-account Webpage authority', async () => {
  // Canonical session creation with the real app purpose; OAuth/app issuance is
  // independently tested by its namespace adapter, not simulated here.
  const token = await home.run(async () => { const session = await createSession(owner.id, { purpose: 'app', meta: { clientId: 'fixture-app', origin, scopes: ['app-data.read'] } });
   return signJwt({ sub: owner.id, jti: session.jti, expiresIn: '1h' }); });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await get('native-route-public', '', headers)).status, 200);
  assert.equal((await get('native-route-private', '', headers)).status, 404);
  assert.equal((await invoke(action, request(preview, '', { blocks }, headers))).status, 401);
 });
 await t.test('canonical workspace membership scopes the actual page handler and revokes on fresh reads', async () => {
  const rootId = 'native-route-workspace';
  const initialized = await home.run(() => initializeWorkspace(owner as any, { rootId, name: 'Route workspace', timeZone: 'UTC' })); assert.equal(initialized.ok, true, JSON.stringify(initialized));
  const member = await home.run(() => saveWorkspaceRecord(owner as any, { rootId, kind: 'member', id: 'route-member', values: { username: 'native-resolve-foreign', role: 'Employee' } }));
  assert.ok(member.id);
  await create('native-route-workspace-page', 'webpage', { name: 'Workspace page', blocks });
  const bound = await home.run(() => bindWorkspacePage(owner as any, { rootId, pageId: 'native-route-workspace-page' })); assert.equal(bound.ok, true, JSON.stringify(bound));
  assert.equal((await get('native-route-workspace-page', foreign.cookie)).status, 200); assert.equal((await get('native-route-workspace-page')).status, 404);
  await home.run(async () => { const current = await getBoundThingsPersistence(null)!.readExact(member.id); assert.ok(current);
   await archiveWorkspaceRecord(owner as any, { rootId, kind: 'member', id: member.id, expectedUpdatedAt: new Date(current.updatedAt).toISOString() }); });
  assert.equal((await get('native-route-workspace-page', foreign.cookie)).status, 404);
 });
 await t.test('protected external-source metadata unit fixture authorizes inherited page and revokes independently', async () => {
  // Canonical external setup/sync is unavailable on native storage. Only these
  // protected relationship/control rows are unit-seeded, never OAuth evidence.
  const at = new Date(), accountId = 'native-route-external-account', postId = 'native-route-external-post', linkId = 'native-route-external-link';
  const row = (id: string, kind: string, extra: Record<string, unknown>) => ({ _id: id, shareId: id, ownerId: 'system', schemaVersion: 2, thingtime: [kind], crystal: {}, acl: [], createdAt: at, updatedAt: at, ...extra });
  await provider.transaction(tx => { const collection = tx.collection(physicalCollectionName('things'));
   for (const doc of [row(accountId, 'external-account', {}), row(postId, 'external-post', { acl: ['tt:extsourced'] }),
    row(linkId, 'external-account-link', { ownerId: foreign.id, crystal: { accountId } }),
    row('native-route-ext-source', 'external-post-source', { parentId: accountId, targetId: postId }),
    row('native-route-ext-page', 'webpage', { ownerId: owner.id, acl: ['tt:inherit'], targetId: postId, crystal: { name: 'Inherited external', blocks } })]) collection.insert(BSON.serialize(doc));
  });
  assert.equal((await get('native-route-ext-page', foreign.cookie)).status, 200); assert.equal((await get('native-route-ext-page')).status, 404);
  await provider.transaction(tx => tx.collection(physicalCollectionName('things')).deleteOne({ op: 'eq', path: ['shareId'], value: linkId }));
  assert.equal((await get('native-route-ext-page', foreign.cookie)).status, 404);
 });
 await t.test('runtime independently admits complete GET and POST operations', async () => {
  assert.equal((await dispatch(loader, request('v1/webpages/resolve?id=native-route-public'))).status, 200);
  assert.equal((await dispatch(action, request(preview, owner.cookie, { blocks }))).status, 200);
 });
 await t.test('revocation is immediate on fresh route reads and the actual storage identity stays native', async () => {
  const changed = await home.run(() => updateThing({ id: foreign.id }, 'native-route-source', { acl: ['tt:user'] })); assert.equal(changed.ok, true, JSON.stringify(changed));
  const response = await get('native-route-public'); assert.equal(response.status, 200); assert.equal((await response.json()).refs['native-route-source'], null);

  await home.run(async () => { const port = getBoundThingsPersistence(owner.id)!;
   assert.equal(port.scope.homePlaneId, profile.homePlaneId); assert.equal((await port.readExact(owner.id))?.ownerId, owner.id); });
 });
});
