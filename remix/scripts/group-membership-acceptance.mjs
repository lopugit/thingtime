#!/usr/bin/env node
// Built HTTP acceptance against a disposable replica set. Fixtures are made
// only through the public registration and group APIs; no user data is read.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-group-membership-'));
const reservePort = async () => {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
};
const dbPort = await reservePort(), apiPort = await reservePort(), adminPort = await reservePort(), legacyPort = await reservePort();
let origin = `http://127.0.0.1:${apiPort}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir, NODE_ENV: 'development',
  HOST: '127.0.0.1', PORT: String(apiPort), MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${dbPort}/thingtime?replicaSet=groupacceptance`,
  JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development', ADMIN_USERNAMES: '' };
const children = [];
const start = (command, args, childEnv = env) => {
  const child = spawn(command, args, { cwd, env: childEnv, detached: true, stdio: 'ignore' });
  children.push(child);
  return child;
};
const waitFor = async (check, label) => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw Error(`Timed out: ${label}`);
};
const request = async (path, { method = 'GET', body, cookie, status = 200 } = {}) => {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, status, `${method} ${path} returned ${response.status}: ${String(data?.error || '').slice(0, 120)}`);
  return { data, cookie: (response.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).join('; ') };
};
const register = async (name) => request('/api/v1/auth/register', { method: 'POST',
  body: { username: name, email: `${name}@example.invalid`, password: randomBytes(32).toString('hex') } });
let mongo;
try {
  await access(join(cwd, '.output/server/index.mjs'));
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || '/opt/homebrew/bin/mongod', ['--dbpath', join(dir, 'db'), '--port', String(dbPort), '--bind_ip', '127.0.0.1', '--replSet', 'groupacceptance', '--nounixsocket']);
  mongo = new MongoClient(`mongodb://127.0.0.1:${dbPort}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await mongo.connect(); return true; } catch { return false; } }, 'replica start');
  await mongo.db('admin').command({ replSetInitiate: { _id: 'groupacceptance', members: [{ _id: 0, host: `127.0.0.1:${dbPort}` }] } });
  await waitFor(async () => (await mongo.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await mongo.close(); mongo = null;
  start(process.execPath, [join(cwd, '.output/server/index.mjs')]);
  await waitFor(async () => { try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok; } catch { return false; } }, 'built API');
  const manifest = (await request('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin);
  assert.equal(manifest.features['api.groups'].version, '1.2.0');
  const owner = await register('batchowner');
  const outsider = await register('batchoutsider');
  console.log(JSON.stringify({ event: 'registered-owner-and-outsider' }));
  // The documented bootstrap first creates the account, then grants the
  // exact username via the server allowlist. Public signup cannot self-mint
  // an env-listed administrator.
  // Start the admin-enabled runtime on another private port against the same
  // disposable database. The original bootstrap server is left untouched and
  // both task-owned processes are stopped in the finalizer.
  env.ADMIN_USERNAMES = 'batchowner';
  env.PORT = String(adminPort);
  origin = `http://127.0.0.1:${adminPort}`;
  start(process.execPath, [join(cwd, '.output/server/index.mjs')]);
  await waitFor(async () => { try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok; } catch { return false; } }, 'admin bootstrap API');
  console.log(JSON.stringify({ event: 'admin-bootstrap-ready' }));
  // This isolated admin test environment needs enough disposable identities
  // to exceed the former one-request boundary. Production limits are untouched.
  await request('/api/v1/admin/rate-limits', { method: 'POST', cookie: owner.cookie,
    body: { endpoints: { 'auth.register': { limit: 10, windowMs: 900000, enabled: false } } } });
  await new Promise(resolve => setTimeout(resolve, 1100));
  if (process.argv.includes('--legacy-only')) {
    const legacyBuild = process.env.GROUP_MEMBERSHIP_LEGACY_BUILD;
    assert(legacyBuild, 'GROUP_MEMBERSHIP_LEGACY_BUILD must name the prior built API entry');
    await access(legacyBuild);
    const updatedMember = (await register('batchlegacy')).data.user.id;
    const currentOrigin = origin;
    const beforeLegacy = (await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes;
    start(process.execPath, [legacyBuild], { ...env, PORT: String(legacyPort) });
    origin = `http://127.0.0.1:${legacyPort}`;
    await waitFor(async () => { try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json')).ok; } catch { return false; } }, 'prior built API');
    const legacy = (await request('/api/v1/groups', { method: 'POST', cookie: owner.cookie,
      body: { name: 'Prior unstamped group', memberIds: [outsider.data.user.id] }, status: 201 })).data.group;
    origin = currentOrigin;
    assert.equal((await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes, beforeLegacy,
      'Prior API created no accounted bytes for its group rows');
    await request('/api/v1/groups', { method: 'PATCH', cookie: owner.cookie,
      body: { id: legacy.id, addMemberIds: [updatedMember] }, status: 503 });
    const unchanged = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === legacy.id);
    assert.equal(unchanged.memberCount, 1, 'Fail-closed legacy edit must not leave a partial grant');
    assert.equal((await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes, beforeLegacy);
    const migrated = await request('/api/v1/admin/migrations/run', { method: 'POST', cookie: owner.cookie,
      body: { migration: 'backfill-user-storage-accounting' } });
    assert(migrated.data.ok, 'Supported migration must accept the prior group rows');
    const migratedBytes = (await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes;
    assert(migratedBytes > beforeLegacy, 'Migration charges prior group and member rows');
    const edited = await request('/api/v1/groups', { method: 'PATCH', cookie: owner.cookie,
      body: { id: legacy.id, addMemberIds: [updatedMember] } });
    assert.equal(edited.data.membership.memberCount, 2);
    assert((await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes > migratedBytes);
    await request('/api/v1/groups', { method: 'DELETE', cookie: owner.cookie, body: { id: legacy.id } });
    assert.equal((await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user.storage.usedBytes, beforeLegacy,
      'Migrated legacy rows and added membership refund exactly on delete');
    console.log(JSON.stringify({ event: 'legacy-passed', priorApiFixture: true, failClosedBeforeMigration: true, migration: true, finiteQuotaEdit: true, ledgerRefund: true }));
  } else if (process.argv.includes('--browser-only')) {
    const require = createRequire(import.meta.url);
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    const context = await chromium.launchPersistentContext(join(dir, 'browser'), { headless: true, viewport: { width: 1280, height: 820 } });
    const evidence = process.env.GROUP_MEMBERSHIP_EVIDENCE_DIR || join(dir, 'evidence');
    await mkdir(evidence, { recursive: true });
    try {
      await context.addCookies(owner.cookie.split('; ').map(pair => {
        const separator = pair.indexOf('=');
        return { name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: '127.0.0.1', path: '/' };
      }));
      const openPicker = async (width, height) => {
        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        await page.goto(origin + '/feed', { waitUntil: 'domcontentloaded' });
        if (await page.getByText('Thingtime could not start').count()) throw new Error('Built browser shell failed before the picker opened');
        await page.getByRole('button', { name: "What's on your mind? ✨" }).click();
        await page.getByLabel('Who can see this post').selectOption('custom');
        await page.getByPlaceholder('Search people, or filter the lists below 🔍').fill('batchoutsider');
        await page.getByRole('button', { name: /batchoutsider/ }).click();
        const dialog = page.getByRole('dialog');
        await dialog.evaluate(element => { element.scrollTop = element.scrollHeight; });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Picker must not cause horizontal page overflow');
        await page.screenshot({ path: join(evidence, `picker-${width}.png`), fullPage: true });
        return page;
      };
      const save = async (page, name) => {
        await page.getByPlaceholder('New group name…').fill(name);
        await page.getByRole('button', { name: 'Save selection as group ➕' }).click();
      };
      const desktop = await openPicker(1280, 820);
      await save(desktop, 'Desktop browser group');
      await desktop.getByText('Group “Desktop browser group” saved 👥').waitFor();
      const desktopGroup = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.name === 'Desktop browser group');
      assert.equal(desktopGroup.memberCount, 1);
      assert.equal(desktopGroup.members[0].id, outsider.data.user.id);
      await desktop.getByRole('button', { name: 'Cancel' }).click();
      await desktop.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); window.scrollTo(0, 0); });
      assert(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await desktop.close();

      const mobile = await openPicker(390, 844);
      let interrupted = false;
      await mobile.route('**/api/v1/groups', async route => {
        if (route.request().method() === 'PATCH' && !interrupted) {
          interrupted = true;
          const response = await route.fetch();
          assert.equal(response.status(), 200, 'Interrupted mobile PATCH committed');
          await route.abort('failed');
        } else await route.continue();
      });
      await save(mobile, 'Recovered mobile group');
      await mobile.getByText('Group “Recovered mobile group” saved 👥').waitFor();
      assert(interrupted, 'The committed PATCH response was interrupted');
      const recovered = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.name === 'Recovered mobile group');
      assert.equal(recovered.memberCount, 1);
      assert.equal(recovered.members[0].id, outsider.data.user.id);
      await mobile.screenshot({ path: join(evidence, 'picker-390-recovered.png'), fullPage: true });
      await mobile.getByText('Group “Recovered mobile group” saved 👥').waitFor({ state: 'hidden' });

      let failedPatch = false, failedReadback = false;
      await mobile.unroute('**/api/v1/groups');
      await mobile.route('**/api/v1/groups', async route => {
        if (route.request().method() === 'PATCH' && !failedPatch) {
          failedPatch = true;
          const response = await route.fetch();
          assert.equal(response.status(), 200, 'Failed-readback PATCH committed');
          await route.abort('failed');
        } else if (route.request().method() === 'GET' && failedPatch && !failedReadback) {
          failedReadback = true;
          await route.abort('failed');
        } else await route.continue();
      });
      await save(mobile, 'Preserved uncertain group');
      await mobile.getByRole('alert').getByText(/Group “Preserved uncertain group” was preserved, but its membership is uncertain/).waitFor();
      assert(failedPatch && failedReadback, 'Both response and readback were interrupted');
      const preserved = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.name === 'Preserved uncertain group');
      assert.equal(preserved.memberCount, 1, 'Uncertain group remains available for recovery');
      assert(!(await mobile.getByRole('alert').textContent()).includes(preserved.id), 'Recovery ID stays out of the picker message');
      await mobile.screenshot({ path: join(evidence, 'picker-390-uncertain.png'), fullPage: true });
      await mobile.getByRole('button', { name: 'Retry membership' }).click();
      await mobile.getByRole('alert').waitFor({ state: 'hidden' });
      const retried = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === preserved.id);
      assert.equal(retried.memberCount, 1, 'Explicit retry keeps one member');
      await mobile.getByRole('button', { name: 'Cancel' }).click();
      await mobile.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); window.scrollTo(0, 0); });
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await mobile.close();
      console.log(JSON.stringify({ event: 'browser-passed', desktop: true, mobile: true, interruptedCommitRecovered: true, uncertainGroupPreserved: true, explicitRetry: true, independentReadback: true }));
    } finally { await context.close(); }
  } else {
  const ids = [];
  const total = 2500;
  for (let offset = 0; offset < total; offset += 8) {
    const batch = await Promise.all(Array.from({ length: Math.min(8, total - offset) }, (_, n) =>
      register(`batch${String(offset + n).padStart(5, '0')}`).then(result => result.data.user.id)));
    ids.push(...batch);
    if (ids.length % 500 === 0) console.log(JSON.stringify({ event: 'registered', count: ids.length }));
  }
  assert.equal(new Set(ids).size, total);
  assert(Buffer.byteLength(JSON.stringify({ id: 'group-id', memberIds: ids })) > 65536, 'Combined IDs exceed former body boundary');
  const usedBytes = async () => {
    const me = (await request('/api/v1/auth/me', { cookie: owner.cookie })).data.user;
    assert.equal(me.storage.status, 'ready', 'Owner storage ledger must be authoritative');
    assert(Number.isSafeInteger(me.storage.usedBytes));
    return me.storage.usedBytes;
  };
  const baselineBytes = await usedBytes();
  const created = (await request('/api/v1/groups', { method: 'POST', cookie: owner.cookie, body: { name: 'Large synthetic group' }, status: 201 })).data.group;
  assert.equal(created.memberCount, 0);
  const emptyGroupBytes = await usedBytes();
  assert(emptyGroupBytes > baselineBytes, 'Creating the billable group charges exact owner storage');
  const patch = (cookie, body, status = 200) => request('/api/v1/groups', { method: 'PATCH', cookie, body: { id: created.id, ...body }, status });
  for (let offset = 0; offset < ids.length; offset += 100) {
    const result = await patch(owner.cookie, { addMemberIds: ids.slice(offset, offset + 100) });
    assert.equal(result.data.membership.memberCount, Math.min(offset + 100, total));
  }
  const fullGroupBytes = await usedBytes();
  assert(fullGroupBytes > emptyGroupBytes, 'Relational member rows charge owner storage');
  assert.equal((await patch(owner.cookie, { addMemberIds: ids.slice(0, 100) })).data.membership.memberCount, total);
  await patch(outsider.cookie, { addMemberIds: [ids[0]] }, 404);
  await patch(owner.cookie, { memberIds: ids.slice(0, 1), addMemberIds: ids.slice(1, 2) }, 400);
  assert.equal((await request('/api/v1/groups', { cookie: outsider.cookie })).data.groups.length, 0);
  const firstRead = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === created.id);
  assert.equal(firstRead.memberCount, total);
  assert.deepEqual(new Set(firstRead.members.map(member => member.id)), new Set(ids));
  const removed = await patch(owner.cookie, { removeMemberIds: ids.slice(0, 100) });
  assert.equal(removed.data.membership.memberCount, total - 100);
  assert((await usedBytes()) < fullGroupBytes, 'Removing members refunds their row bytes');
  const secondRead = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === created.id);
  assert.equal(secondRead.memberCount, total - 100);
  assert.deepEqual(new Set(secondRead.members.map(member => member.id)), new Set(ids.slice(100)));
  await Promise.all([
    patch(owner.cookie, { removeMemberIds: ids.slice(100, 150) }),
    patch(owner.cookie, { addMemberIds: [outsider.data.user.id] })
  ]);
  const concurrentRead = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === created.id);
  assert.equal(concurrentRead.memberCount, total - 149);
  assert.deepEqual(new Set(concurrentRead.members.map(member => member.id)), new Set([...ids.slice(150), outsider.data.user.id]));
  const beforeRefusalBytes = await usedBytes();
  const catalog = (await request('/api/v1/admin/subscriptions', { cookie: owner.cookie })).data.catalog;
  const freeTier = catalog.find(tier => tier.id === 'free');
  assert(freeTier?.versionId, 'Default tier must be available for isolated quota test');
  await request('/api/v1/admin/subscriptions', { method: 'POST', cookie: owner.cookie, body: {
    subjectType: 'user', subjectId: owner.data.user.id, tier: freeTier.id, tierVersionId: freeTier.versionId,
    overrides: { userStorageBytes: beforeRefusalBytes + 1 }
  } });
  const beforeRefusalGroup = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === created.id);
  await patch(owner.cookie, { addMemberIds: [ids[0]] }, 507);
  assert.equal(await usedBytes(), beforeRefusalBytes, 'Quota refusal must not charge the ledger');
  const afterRefusalGroup = (await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.find(group => group.id === created.id);
  assert.deepEqual(afterRefusalGroup, beforeRefusalGroup, 'Quota refusal must roll back root timestamp and membership');
  await request('/api/v1/admin/subscriptions', { method: 'POST', cookie: owner.cookie, body: { subjectType: 'user', subjectId: owner.data.user.id, clear: true } });
  await request('/api/v1/groups', { method: 'DELETE', cookie: owner.cookie, body: { id: created.id } });
  assert.equal((await request('/api/v1/groups', { cookie: owner.cookie })).data.groups.some(group => group.id === created.id), false);
  assert.equal(await usedBytes(), baselineBytes, 'Delete refunds the group and every remaining member row');
  console.log(JSON.stringify({ event: 'passed', members: total, combinedBytesAboveFormerBoundary: true, ownerFence: true, replay: true, remove: true, concurrentDeltaPreserved: true, quotaRollback: true, ledgerRefund: true, fullReadback: true }));
  }
} finally {
  if (mongo) await mongo.close().catch(() => {});
  for (const child of children.reverse()) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await new Promise(resolve => setTimeout(resolve, 500));
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  await rm(dir, { recursive: true, force: true });
}
