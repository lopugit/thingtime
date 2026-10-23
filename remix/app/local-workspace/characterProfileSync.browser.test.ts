import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_CHARACTER_PROFILE_SYNC_URL || process.env.TT_RENDER_ORIGIN;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_CHARACTER_PROFILE_SYNC_ARTIFACTS;
test('native session delegates private theme and algorithm sync without principal fallback', { skip: !base || !playwrightPath, timeout: 180_000 }, async () => {
 assert.equal(new URL(base).hostname, '127.0.0.1');
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 if (process.env.TT_RENDER_SESSION) assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
 const { chromium } = await import(playwrightPath);
 const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const guest = await browser.newContext(), page = await context.newPage(), checks = [];
 // Docker enforces network:none independently of Chromium's online signal.
 // Mark loopback connectivity online so the actual app can load its roster.
 const network = await context.newCDPSession(page);
 await network.send('Network.enable');
 await network.send('Network.overrideNetworkState', { offline: false, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
 const send = (path, body, actor = undefined, extra = {}, target = page) => target.evaluate(async ({ path, body, actor, extra }) => {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json',
   ...(actor ? { 'X-Thingtime-Character': actor } : {}), ...extra }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cache: response.headers.get('Cache-Control') };
 }, { path, body, actor, extra });
 const ok = (result, label) => { assert.equal(result.status, 200, label + ': ' + JSON.stringify(result.data)); checks.push(label); return result.data; };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const manifest = await (await fetch(base + '/.well-known/thingtime-capabilities.json')).json();
  const routes = await (await fetch(base + '/api/v1/capabilities')).json();
  assert.equal(manifest.origin, base);
  for (const [kind, version] of [['themes', '1.6.0'], ['algorithms', '1.4.0']]) {
   assert.equal(manifest.features[`api.${kind}-sync`].version, version);
   assert.equal(routes.features[`api.${kind}-sync`], version);
   assert.ok(manifest.operations.some(row => row.path === `/api/v1/${kind}/sync` && row.methods.includes('POST')));
  }
  const username = 'char-profile-' + randomUUID().slice(0, 8);
  const registration = await context.request.post(base + '/api/v1/auth/register', { headers: { Origin: base },
   data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200); const owner = (await registration.json()).user.id;
  await page.goto(base + '/feed');
  assert.equal(await page.evaluate(async () => (await (await fetch('/api/v1/auth/me')).json()).user?.id), owner);
  const create = async displayName => ok(await send('/api/v1/auth/characters', { operation: 'create', requestId: randomUUID(), displayName, loginMode: 'switch' }), 'Create disposable Character').character.user.id;
  const a = await create('Profile actor A'), b = await create('Profile actor B');
  const other = await browser.newContext(), otherPage = await other.newPage();
  const otherName = 'char-other-' + randomUUID().slice(0, 8);
  const otherRegistration = await other.request.post(base + '/api/v1/auth/register', { headers: { Origin: base },
   data: { username: otherName, email: otherName + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(otherRegistration.status(), 200);
  await otherPage.goto(base + '/feed');
  const foreignActor = ok(await send('/api/v1/auth/characters', { operation: 'create', requestId: randomUUID(), displayName: 'Foreign profile actor', loginMode: 'switch' }, undefined, {}, otherPage), 'Create another account Character').character.user.id;
  await page.reload(); await page.getByLabel('Post as', { exact: true }).first().selectOption(a);
  for (const kind of ['themes', 'algorithms']) {
   const path = `/api/v1/${kind}/sync`, headers = { 'X-Thingtime-Expected-Data-Plane': 'home' };
   const sync = (operation, actor, command = undefined, extra = {}) => send(path, { operation, expectedOwnerId: actor, ...(command ? { command } : {}) }, actor, { ...headers, ...extra });
   const id = randomUUID(), writeId = randomUUID();
   const command = kind === 'themes'
    ? { action: 'save', id, writeId, expectedVersion: null, name: 'Character peach', theme: {}, visibility: 'private' }
    : { action: 'save', id, writeId, expectedVersion: null, content: { name: 'Character reading', emoji: '🌱', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null }, description: '' };
   const created = ok(await sync('write', a, command), `${kind}: delegated creation`);
   assert.equal(created.ownerId, a); assert.equal(created.storagePlane, 'home');
   assert.deepEqual(ok(await sync('write', a, command), `${kind}: immutable retry`).acknowledgment, created.acknowledgment);
   for (const actor of [a, b, owner]) {
    const result = await sync('snapshot', actor);
    assert.equal(result.cache, 'private, no-store');
    const snapshot = ok(result, `${kind}: isolated snapshot ${actor === a ? 'actor' : actor === b ? 'sibling' : 'principal'}`);
    assert.equal(snapshot[kind].some(row => row.id === id), actor === a);
   }
   const selection = ok(await sync('selection', a), `${kind}: delegated selection read`).selection;
   const pointer = kind === 'themes' ? 'themeId' : 'algorithmId';
   const choice = { [pointer]: id, expectedVersion: selection.version, writeId: randomUUID() };
   const chosen = ok(await sync('select', a, choice), `${kind}: delegated selection write`).acknowledgment;
   assert.equal(chosen.result[pointer], id);
   assert.deepEqual(ok(await sync('select', a, choice), `${kind}: selection retry`).acknowledgment, chosen);
   const mismatched = await send(path, { operation: 'snapshot', expectedOwnerId: a }, b, headers);
   assert.equal(mismatched.status, 409); assert.equal(mismatched.data.code, 'ACTOR_CHANGED');
   const guestResponse = await guest.request.post(base + path, { headers: { Origin: base, ...headers, 'X-Thingtime-Character': a }, data: { operation: 'snapshot', expectedOwnerId: a } });
   assert.equal(guestResponse.status(), 401);
   const foreign = await send(path, { operation: 'snapshot', expectedOwnerId: foreignActor }, foreignActor, headers);
   assert.equal(foreign.status, 401);
   ok(await send('/api/v1/auth/characters', { operation: 'select', characterId: a }), 'Select session Character');
   const selected = ok(await send(path, { operation: 'snapshot', expectedOwnerId: a }, undefined, headers), `${kind}: session selection`);
   assert.equal(selected.ownerId, a); assert.equal(selected[kind].some(row => row.id === id), true);
   ok(await send('/api/v1/auth/characters', { operation: 'select', characterId: null }), 'Restore disposable principal');
   const denied = await sync('snapshot', a, undefined, { 'X-Thingtime-Expected-Data-Plane': 'custom-' + 'a'.repeat(64) });
   assert.equal(denied.status, 409);
  }
  ok(await send('/api/v1/auth/characters', { operation: 'disable', characterId: a }), 'Disable disposable Character');
  for (const kind of ['themes', 'algorithms']) {
   const denied = await send(`/api/v1/${kind}/sync`, { operation: 'snapshot', expectedOwnerId: a }, a, { 'X-Thingtime-Expected-Data-Plane': 'home' });
   assert.equal(denied.status, 401); assert.equal(denied.data[kind], undefined);
   ok(await send(`/api/v1/${kind}/sync`, { operation: 'snapshot', expectedOwnerId: b }, b, { 'X-Thingtime-Expected-Data-Plane': 'home' }), `${kind}: sibling survives revocation`);
  }
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ checks, currentManifests: true, privateActorIsolation: true, anonymousRefused: true, immutableRetries: true, selectedSession: true, disabledCharacterRefused: true }, null, 2));
 } catch (error) {
  if (artifacts) {
   await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
   await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ checks, message: error.message }, null, 2));
  }
  throw error;
 } finally { await browser.close(); }
});
