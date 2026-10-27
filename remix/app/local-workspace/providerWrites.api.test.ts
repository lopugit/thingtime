import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_PROVIDER_WRITES_API_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_PROVIDER_WRITES_API_ARTIFACTS;
test('account Vault synchronization uses canonical mutations and retained exact-write receipts', {
 skip: !base || !playwrightPath || !artifacts, timeout: 120_000
}, async () => {
 const url = new URL(base!); assert.ok(['localhost','127.0.0.1'].includes(url.hostname)); assert.ok(!url.username && !url.password);
 const { request } = await import(playwrightPath!);
 const origin = url.origin, headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' };
 const context = await request.newContext({ baseURL: origin }), anonymous = await request.newContext({ baseURL: origin }), other = await request.newContext({ baseURL: origin });
 const evidence: { fixtureOnly: true; checks: Array<{ label: string; status: number }>; complete?: true; fixtureEntriesCleaned?: true } = { fixtureOnly: true, checks: [] };
 const created = new Set<string>(); let ownerId: string | undefined;
 const check = async (response: any, label: string, status = 200) => {
  evidence.checks.push({ label, status: response.status() }); assert.equal(response.status(), status, label); return response.json();
 };
 const write = (command: Record<string, unknown>, selected = context, overrides = {}) => selected.post('/api/v1/lopu/vault', { headers, data: { action: 'sync-write', expectedOwnerId: ownerId, command, ...overrides } });
 const read = async (id: string) => (await check(await context.get('/api/v1/things', { params: { id } }), 'read fixture Thing')).thing;
 const metadata = async () => check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'sync-metadata', expectedOwnerId: ownerId } }), 'complete fixture metadata');
 const command = <T extends Record<string, unknown> = Record<string, unknown>>(action: string, fields: T = {} as T, id = randomUUID(), expectedVersion: string | null = null) => ({ action, id, writeId: randomUUID(), expectedVersion, ...fields });
 const assertVersion = async (id: string, version: string) => {
  const snapshot = await metadata(), record = [...snapshot.groups, ...snapshot.entries].find((entry: any) => entry.id === id); assert.equal(record?.version, version);
 };
 const register = async (client: any) => {
  const username = 'vaultwrites-' + randomUUID().slice(0, 8);
  return check(await client.post('/api/v1/auth/register', { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } }), 'register disposable account');
 };
 try {
  ownerId = (await register(context)).user.id; await register(other);
  const group = command('create-group', { name: 'Synthetic sync environment' }); created.add(group.id);
  await check(await write(group, anonymous), 'anonymous cannot sync', 401);
  await check(await write(group, other), 'wrong owner cannot sync', 409);
  await check(await context.post('/api/v1/lopu/vault', { headers: { ...headers, Origin: 'https://unrelated.example' }, data: { action: 'sync-write', expectedOwnerId: ownerId, command: group } }), 'cross-origin cannot sync', 403);
  await check(await context.post('/api/v1/lopu/vault', { headers: { Origin: origin }, data: { action: 'sync-write', expectedOwnerId: ownerId, command: group } }), 'missing database confirmation refused', 400);
  await check(await context.post('/api/v1/lopu/vault', { headers: { ...headers, 'X-Thingtime-Expected-Data-Plane': 'custom-'+'a'.repeat(64) }, data: { action: 'sync-write', expectedOwnerId: ownerId, command: group } }), 'wrong database confirmation refused', 409);
  await check(await context.post('/api/v1/lopu/vault', { headers: { ...headers, 'Content-Type': 'text/plain' }, data: JSON.stringify({ action:'sync-write',expectedOwnerId:ownerId,command:group }) }), 'JSON-only mutation boundary retained', 415);
  await check(await write(group, context, { ownerId: 'forged-owner' }), 'closed wrapper rejects authority fields', 400);
  await check(await write({ ...group, acl: ['tt:all'] }), 'closed command rejects publication fields', 400);

  const savedGroup = await check(await write(group), 'sync create environment'), groupReceipt = savedGroup.acknowledgment;
  assert.equal(savedGroup.ownerId, ownerId); await assertVersion(group.id, groupReceipt.resultVersion);
  assert.deepEqual((await check(await write(group), 'exact environment retry')).acknowledgment, groupReceipt);
  await check(await write({ ...group, name: 'Changed replay payload' }), 'changed replay payload refused', 409);
  await assertVersion(group.id, groupReceipt.resultVersion);

  const invalidMembership = command('save-secret', { name: 'Missing environment', key: 'KEY', value: 'Synthetic rollback fixture', groupId: 'missing-environment' }); created.add(invalidMembership.id);
  await check(await write(invalidMembership), 'missing environment creation rolls back', 409);
  await check(await context.get('/api/v1/things', { params: { id: invalidMembership.id } }), 'rolled-back entry absent', 404); created.delete(invalidMembership.id);
  await check(await write(command('save-secret', { name:'Oversized',key:'KEY',value:'x'.repeat(50_000) })), 'input byte bound retained', 413);

  const secret = command('save-secret', { name: 'Synthetic synchronized secret', key: 'SYNC_FIXTURE_KEY', value: ' Synthetic sync fixture value\n', groupId: group.id }); created.add(secret.id);
  const simultaneous = await Promise.all([write(secret), write(secret)]);
  const first = await check(simultaneous[0], 'concurrent exact create first'), second = await check(simultaneous[1], 'concurrent exact create second');
  assert.deepEqual(first.acknowledgment, second.acknowledgment); await assertVersion(secret.id, first.acknowledgment.resultVersion);
  await check(await write(command('delete', {}, group.id, groupReceipt.resultVersion)), 'nonempty environment deletion rolls back', 409);
  await assertVersion(group.id, groupReceipt.resultVersion);
  const thing = await read(secret.id); assert.deepEqual(thing.acl, ['tt:user']); assert.equal(thing.author?.id, ownerId);
  assert.equal(thing.crystal.systemType, 'tt.lopuUserVault'); assert.ok(!JSON.stringify(thing).includes(secret.value as string));
  const history = await check(await context.get('/api/v1/timeline', { params: { ownerId, dataPlane: 'home', thingId: secret.id } }), 'canonical create and completion history');
  assert.equal(history.entries.length, 2); assert.equal(history.entries.filter((entry: any) => entry.event.operation === 'create').length, 1);
  const receiptEntry = history.entries.find((entry: any) => entry.event.id === 'vault-write-' + secret.writeId); assert.ok(receiptEntry);
  assert.equal(receiptEntry.event.source, 'api'); assert.equal(receiptEntry.event.mode, 'effect');
  for (const text of [secret.value, secret.key, secret.name]) assert.ok(!JSON.stringify(receiptEntry).includes(String(text)));
  await check(await context.post('/api/v1/timeline', { params: { ownerId, dataPlane: 'home' }, headers, data: receiptEntry.event }), 'client cannot forge server receipt', 400);

  const version = first.acknowledgment.resultVersion;
  const updateA = command('save-secret', { name: 'First competing change', key: 'SYNC_FIXTURE_KEY', value: 'Synthetic contender A', groupId: group.id }, secret.id, version);
  const updateB = command('save-secret', { name: 'Second competing change', key: 'SYNC_FIXTURE_KEY', value: 'Synthetic contender B', groupId: group.id }, secret.id, version);
  const updated = await Promise.all([write(updateA), write(updateB)]);
  assert.deepEqual(updated.map(response => response.status()).sort(), [200,409]);
  const winnerIndex = updated.findIndex(response => response.status() === 200), winner = [updateA,updateB][winnerIndex];
  const winningReceipt = (await check(updated[winnerIndex], 'one conditional update wins')).acknowledgment; await assertVersion(secret.id, winningReceipt.resultVersion);
  const unchanged = await read(secret.id);
  await check(await write(command('save-secret', { name: 'Null is explicit create only', key: 'KEY', value: 'Synthetic refusal', groupId: null }, secret.id)), 'create cannot overwrite existing entry', 409);
  await assertVersion(secret.id, winningReceipt.resultVersion);
  assert.deepEqual((await check(await write(winner), 'exact conditional update retry')).acknowledgment, winningReceipt);

  await check(await context.patch('/api/v1/things', { headers, data: { id: secret.id, expectedUpdatedAt: unchanged.updatedAt, crystal: { name: 'Edited through normal generic editor' } } }), 'normal generic edit');
  await check(await write(command('move-entry', { groupId: null }, secret.id, winningReceipt.resultVersion)), 'stale generic-edit version refused', 409);
  const current = (await metadata()).entries.find((entry: any) => entry.id === secret.id);
  const move = command('move-entry', { groupId: null }, secret.id, current.version);
  const moved = (await check(await write(move), 'conditional environment move')).acknowledgment; await assertVersion(secret.id, moved.resultVersion);
  const removedGroup = command('delete', {}, group.id, groupReceipt.resultVersion);
  const deleteReceipt = (await check(await write(removedGroup), 'conditional environment delete')).acknowledgment; created.delete(group.id);
  assert.equal(deleteReceipt.resultVersion, null); assert.deepEqual((await check(await write(removedGroup), 'deleted environment retry')).acknowledgment, deleteReceipt);

  await check(await context.delete('/api/v1/things', { headers, data: { id: secret.id } }), 'normal generic deletion after acknowledged create'); created.delete(secret.id);
  assert.deepEqual((await check(await write(secret), 'lost-create-response retry after generic deletion')).acknowledgment, first.acknowledgment);
  await check(await context.get('/api/v1/things', { params: { id: secret.id } }), 'retry did not recreate deleted entry', 404);
  await check(await write(command('save-secret', { name: 'Missing update', key: 'KEY', value: 'Synthetic refusal' }, secret.id, moved.resultVersion)), 'missing update cannot become create', 409);
  const retained = await check(await context.get('/api/v1/timeline', { params: { ownerId, dataPlane: 'home', thingId: secret.id, eventId: receiptEntry.event.id } }), 'completion retained after target deletion');
  assert.deepEqual(retained.entry, receiptEntry);

  const provider = command('save-provider', { name: 'Synthetic sync provider', provider: 'compatible', endpoint: 'https://provider.example/v1', token: 'synthetic-provider-token' }); created.add(provider.id);
  const providerReceipt = (await check(await write(provider), 'sync provider creation')).acknowledgment; await assertVersion(provider.id, providerReceipt.resultVersion);
  const providerBefore = await read(provider.id);
  const providerEdit = command('save-provider', { name: 'Renamed provider', provider: 'compatible', endpoint: 'https://provider.example/v1', token: null }, provider.id, providerReceipt.resultVersion);
  const providerEdited = (await check(await write(providerEdit), 'provider metadata-only save')).acknowledgment; await assertVersion(provider.id, providerEdited.resultVersion);
  assert.deepEqual((await read(provider.id)).crystal.encryptedValue, providerBefore.crystal.encryptedValue);
  const providerDelete = command('delete', {}, provider.id, providerEdited.resultVersion);
  const providerDeleted = (await check(await write(providerDelete), 'sync provider deletion')).acknowledgment; created.delete(provider.id);
  assert.deepEqual((await check(await write(providerDelete), 'sync provider deletion retry')).acknowledgment, providerDeleted);

  const invalidProvider = command('save-provider', { name: 'Blocked private endpoint', provider: 'compatible', endpoint: 'https://127.0.0.1/v1', token: 'synthetic-provider-token' });
  await check(await write(invalidProvider), 'existing provider network policy retained', 400);
  await check(await context.get('/api/v1/things', { params: { id: invalidProvider.id } }), 'refused provider absent', 404);
  evidence.complete = true;
 } finally {
  try {
   for (const id of [...created].reverse()) {
    const existing = await context.get('/api/v1/things', { params: { id } }); if (existing.status() === 404) continue;
    await check(existing, 'read remaining cleanup fixture');
    await check(await context.post('/api/v1/lopu/vault', { headers, data: { action: 'delete', id } }), 'cleanup remaining fixture');
   }
   if (ownerId) { const remaining = await metadata(); assert.deepEqual(remaining.groups, []); assert.deepEqual(remaining.entries, []); evidence.fixtureEntriesCleaned = true; }
   await mkdir(artifacts!, { recursive: true }); await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify(evidence, null, 2));
  } finally { await Promise.all([context.dispose(), anonymous.dispose(), other.dispose()]); }
 }
});
