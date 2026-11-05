import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_PROVIDER_INTEGRITY_API_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_PROVIDER_INTEGRITY_API_ARTIFACTS;

test('generic and dedicated Vault mutations preserve environment membership, including concurrent deletion', {
 skip: !base || !playwrightPath || !artifacts, timeout: 120_000
}, async () => {
 const url = new URL(base!); assert.ok(['localhost', '127.0.0.1'].includes(url.hostname)); assert.ok(!url.username && !url.password);
 const { request } = await import(playwrightPath!);
 const origin = url.origin, headers = { Origin: origin }, context = await request.newContext({ baseURL: origin });
 const evidence: { fixtureOnly: true; checks: Array<{ label: string; status: number }>; races: Array<{ deletion: number; creation: number }>; complete?: true; fixtureEntriesCleaned?: true } = { fixtureOnly: true, checks: [], races: [] };
 const created = new Set<string>();
 const check = async (response: any, label: string, status = 200) => {
  evidence.checks.push({ label, status: response.status() }); assert.equal(response.status(), status, label); return response.json();
 };
 let ownerId: string | undefined;
 const metadata = async () => check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'sync-metadata', expectedOwnerId: ownerId } }), 'complete metadata');
 const group = async () => {
  const result = await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'create-group', name: 'Synthetic environment' } }), 'create fixture environment');
  created.add(result.group.id); return result.group.id as string;
 };
 const secretBody = (groupId: string | null) => ({ action: 'save-secret', name: 'Synthetic child', key: 'FIXTURE_KEY', value: 'Synthetic fixture only', groupId });
 const readThing = async (id: string) => (await check(await context.get('/api/v1/things', { params: { id } }), 'read fixture version')).thing;
 const patch = async (id: string, crystal: unknown) => {
  const current = await readThing(id);
  return context.patch('/api/v1/things', { headers, data: { id, expectedUpdatedAt: current.updatedAt, crystal } });
 };
 try {
  const username = 'vaultintegrity-' + randomUUID().slice(0, 8);
  const registered = await check(await context.post('/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } }), 'register disposable account'); ownerId = registered.user.id;
  const groupId = await group();
  const saved = await check(await context.post('/api/v1/lopu/vault', { headers, data: secretBody(groupId) }), 'create grouped child'); const childId = saved.entry.id; created.add(childId);
  const before = await metadata();
  const source = await readThing(childId), invalidCreateId = randomUUID(); created.add(invalidCreateId);
  await check(await context.post('/api/v1/things', { headers, data: { shareId: invalidCreateId, thingtime: ['data'], acl: ['tt:user'], crystal: { ...source.crystal, groupId: 'missing-environment' } } }), 'generic creation with missing environment rolls back', 409);
  await check(await context.get('/api/v1/things', { params: { id: invalidCreateId } }), 'refused generic creation is absent', 404); created.delete(invalidCreateId);
  await check(await context.delete('/api/v1/things', { headers, data: { id: groupId } }), 'generic nonempty environment deletion refused', 409);
  await check(await patch(groupId, { recordKind: 'secret' }), 'generic nonempty environment conversion refused', 409);
  await check(await patch(childId, { groupId: 'missing-environment' }), 'generic missing environment assignment refused', 409);
  await check(await patch(childId, { groupId: childId }), 'self environment assignment refused', 409);
  const unchanged = await metadata(); assert.deepEqual(unchanged.groups, before.groups); assert.deepEqual(unchanged.entries, before.entries);
  await check(await patch(groupId, { name: 'Renamed through generic editor' }), 'valid generic group rename');
  await check(await patch(childId, { name: 'Renamed through generic editor' }), 'valid generic entry rename');
  await check(await patch(childId, { groupId: null }), 'generic ungrouping');
  await check(await context.delete('/api/v1/things', { headers, data: { id: groupId } }), 'empty group deletion'); created.delete(groupId);
  await check(await context.post('/api/v1/lopu/vault', { headers, data: secretBody(groupId) }), 'late creation cannot reference a deleted environment', 400);
  const ungrouped = await metadata(); assert.equal(ungrouped.groups.length, 0); assert.equal(ungrouped.entries[0].groupId, null);
  await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'delete', id: childId } }), 'remove ungrouped fixture'); created.delete(childId);

  // Both operations use the real API and the ordinary content transaction.
  // Either serialization order is valid; an acknowledged orphan never is.
  for (let iteration = 0; iteration < 4; iteration++) {
   const racingGroup = await group();
   const [deletion, creation] = await Promise.all([
    context.delete('/api/v1/things', { headers, data: { id: racingGroup } }),
    context.post('/api/v1/lopu/vault', { headers, data: secretBody(racingGroup) })
   ]);
   evidence.races.push({ deletion: deletion.status(), creation: creation.status() });
   if (deletion.status() === 200) created.delete(racingGroup);
   let racingChild: string | undefined;
   if (creation.status() === 200) { racingChild = (await creation.json()).entry.id; created.add(racingChild!); }
   assert.ok((deletion.status() === 200 && [400, 409].includes(creation.status())) || (deletion.status() === 409 && creation.status() === 200), 'the losing write must observe the winning membership change');
   const snapshot = await metadata();
   if (racingChild) {
    assert.ok(snapshot.groups.some((entry: any) => entry.id === racingGroup));
    assert.equal(snapshot.entries.find((entry: any) => entry.id === racingChild)?.groupId, racingGroup);
    await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'delete', id: racingChild } }), 'cleanup race child'); created.delete(racingChild);
   }
   if (created.has(racingGroup)) { await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'delete', id: racingGroup } }), 'cleanup race group'); created.delete(racingGroup); }
  }
  evidence.complete = true;
 } finally {
  try {
   for (const id of [...created].reverse()) {
    const current = await context.get('/api/v1/things', { params: { id } });
    if (current.status() === 404) continue;
    await check(current, 'read remaining cleanup fixture');
    await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'delete', id } }), 'cleanup remaining fixture');
   }
   if (ownerId) { const empty = await metadata(); assert.deepEqual(empty.groups, []); assert.deepEqual(empty.entries, []); evidence.fixtureEntriesCleaned = true; }
   await mkdir(artifacts!, { recursive: true }); await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify(evidence, null, 2));
  } finally { await context.dispose(); }
 }
});
