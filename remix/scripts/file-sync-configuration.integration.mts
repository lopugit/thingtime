// Opt-in: exercise ordinary editable Things through the real API, never Mongo.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { newFileSyncConfiguration } from '../app/fileSync/configuration';
import { readOwnedFileSyncConfiguration, planConfiguredFileSync } from '../app/fileSync/configuredPlan';
const path = process.argv[2];
if (!path || ((await stat(path)).mode & 0o077)) throw Error('Pass a mode-0600 disposable fixture');
const fixture = JSON.parse(await readFile(path, 'utf8')), base = new URL(fixture.base);
if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname) || base.origin !== fixture.base || base.username || base.password) throw Error('Use a canonical loopback fixture');
const cookies = new Map<string, string>();
async function call(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', auth = true) {
 const response = await fetch(base.origin + route, { method, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: {
  Accept: 'application/json', Origin: base.origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  ...(auth ? { Cookie: [...cookies].map(([k,v]) => `${k}=${v}`).join('; ') } : {})
 }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
 if (auth) for (const header of response.headers.getSetCookie()) { const pair = header.split(';')[0], i = pair.indexOf('='); cookies.set(pair.slice(0,i), pair.slice(i+1)); }
 const data = await response.json(); return { status: response.status, data };
}
async function ok(route: string, body?: unknown, method?: string) {
 const r = await call(route, body, method); assert.equal(r.status, 200, `${route.split('?')[0]} status: ${r.data.error ?? ''}`); assert.notEqual(r.data.ok, false); return r.data;
}
const created: string[] = []; let signedIn = false; const errors: unknown[] = [];
try {
 const discovery = await ok('/.well-known/thingtime-capabilities.json'); assert.equal(discovery.features['api.things'].version, '1.35.0');
 const schemas = await ok('/api/v1/schemas'); assert.ok(schemas.schemas.some((s: any) => s.id === 'file-sync'));
 await ok('/api/v1/login', { username: fixture.username, password: fixture.password }); signedIn = true;
 assert.equal((await ok('/api/v1/auth/me')).user.id, fixture.userId);
 const cloud = (await ok('/api/v1/things', { thingtime: ['folder'], crystal: { name: 'Sync configuration acceptance' } })).thing; created.push(cloud.id);
 const config = newFileSyncConfiguration({ name: 'Selected device documents', deviceId: 'fixture-device', localRootId: randomUUID(), remoteFolderId: cloud.id });
 const first = (await ok('/api/v1/things', { thingtime: ['file-sync'], crystal: config })).thing; created.push(first.id);
 assert.deepEqual(first.acl, ['tt:user']);
 const fresh = (await ok(`/api/v1/things?id=${first.id}`)).thing;
 const saved = readOwnedFileSyncConfiguration(fresh, fixture.userId); assert.deepEqual(saved.configuration, config);
 assert.ok((await ok('/api/v1/things?thingtime=file-sync')).things.some((t: any) => t.id === first.id));
 assert.equal((await call(`/api/v1/things?id=${first.id}`, undefined, 'GET', false)).status, 404);
 assert.equal((await call('/api/v1/things', { thingtime: ['file-sync'], crystal: { ...config, localRootId: 'content://private' } })).status, 400);
 assert.equal((await call('/api/v1/things', { thingtime: ['file-sync'], crystal: { ...config, excludedPaths: ['../outside'] } })).status, 400);
 const update = { ...config, mode: 'backup', network: 'any', chargingOnly: true, excludedPaths: ['Private'], paused: false };
 await ok('/api/v1/things', { id: first.id, crystal: update, expectedUpdatedAt: fresh.updatedAt }, 'PATCH');
 const edited = (await ok(`/api/v1/things?id=${first.id}`)).thing;
 const current = readOwnedFileSyncConfiguration(edited, fixture.userId); assert.deepEqual(current.configuration, update);
 assert.equal((await call('/api/v1/things', { id: first.id, crystal: { name: 'Stale overwrite' }, expectedUpdatedAt: fresh.updatedAt }, 'PATCH')).status, 409);
 const scope = { origin: base.origin, ownerId: fixture.userId, dataPlane: 'home', rootId: first.id, deviceId: config.deviceId };
 const parameters = { saved: current, approval: { ...saved, scope }, local: { scope, complete: true, entries: [] }, remote: { scope, complete: true, entries: [] },
  baseline: { scope, entries: [] }, localRootId: config.localRootId, remoteFolderId: cloud.id, conditions: { network: 'wifi' as const, charging: true } };
 assert.throws(() => planConfiguredFileSync(parameters), /approval changed/);
 const ownApproval = { ...current, scope };
 assert.deepEqual(planConfiguredFileSync({ ...parameters, approval: ownApproval, conditions: { network: 'wifi', charging: null } }), { status: 'waiting', reason: 'charging' });
 assert.equal(planConfiguredFileSync({ ...parameters, approval: ownApproval }).status, 'ready');
 await ok('/api/v1/things', { id: first.id, acl: ['tt:all'], expectedUpdatedAt: edited.updatedAt }, 'PATCH');
 const shared = (await ok(`/api/v1/things?id=${first.id}`)).thing; assert.throws(() => readOwnedFileSyncConfiguration(shared, fixture.userId), /private configuration/);
 console.log('PASS: public schema; private ordinary Thing create/list/read; exact configuration round-trip; invalid path rejection; guarded edit/stale 409; changed-approval refusal; charging gate; shared configuration cannot execute. No native grants or transfers exercised.');
} catch (error) { errors.push(error); } finally {
 for (const id of created.reverse()) {
  try { const latest = await ok(`/api/v1/things?id=${id}`); await ok('/api/v1/things', { id, expectedUpdatedAt: latest.thing.updatedAt }, 'DELETE'); } catch (error) { errors.push(error); }
 }
 if (signedIn) try { await ok('/api/v1/auth/logout', {}); } catch (error) { errors.push(error); }
}

if (errors.length) throw new AggregateError(errors, 'Configuration acceptance or cleanup failed');
