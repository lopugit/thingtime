import assert from 'node:assert/strict';
import test from 'node:test';
import { Binary } from 'mongodb';
import { REMOTE_SYNC_RESULT_BYTES } from '~/fileSync/remoteSyncProtocol';
import { createDeviceSyncControlService, DEVICE_SYNC_REQUEST_MS } from './deviceSyncControl';
import { isProtectedThingtime, EPHEMERAL_CONTROL_THINGTIMES, DEVICE_CONTROL_THINGTIME } from '~/schemas/registry';

const valueAt = (row: any, key: string) => key.split('.').reduce((value, part) => value?.[part], row);
const same = (a: any, b: any): boolean => a instanceof Binary && b instanceof Binary ? a.toString() === b.toString() :
  Array.isArray(a) ? a.some(value => same(value, b)) : a === b;
const matches = (row: any, query: any) => Object.entries(query).every(([key, expected]: any) => {
  const value = valueAt(row, key);
  if (expected && typeof expected === 'object' && !(expected instanceof Binary)) {
    if ('$gt' in expected) return value > expected.$gt;
    if ('$in' in expected) return expected.$in.some((candidate: any) => same(value, candidate));
    if ('$type' in expected) return typeof value === expected.$type;
  }
  return same(value, expected);
});
const assign = (row: any, key: string, value: any) => {
  const path = key.split('.'), field = path.pop()!;
  path.reduce((target, part) => target[part] ??= {}, row)[field] = value;
};
function fixture() {
  let time = new Date('2026-10-23T01:00:00Z'), sequence = 0;
  const records: any[] = [{ shareId: 'device', thingtime: ['device'], ownerId: 'owner' }];
  const credentials: any[] = [{ purpose: 'device', userId: 'owner', meta: { deviceId: 'device' }, revokedAt: null,
    expiresAt: new Date(time.getTime() + 24 * 60 * 60_000), jti: 'pairing-one' }];
  const apply = (row: any, change: any) => {
    for (const [key, value] of Object.entries(change.$set ?? {})) assign(row, key, value);
    for (const key of Object.keys(change.$currentDate ?? {})) assign(row, key, time);
  };
  const collection = {
    findOne: async (query: any) => records.find(row => matches(row, query)) ?? null,
    countDocuments: async (query: any) => records.filter(row => matches(row, query)).length,
    updateOne: async (query: any, change: any) => { const row = records.find(row => matches(row, query)); if (row) apply(row, change); return { matchedCount: row ? 1 : 0 }; },
    findOneAndUpdate: async (query: any, change: any) => { const row = records.find(row => matches(row, query)); if (row) apply(row, change); return row ?? null; }
  };
  const service = createDeviceSyncControlService({ things: async () => collection,
    sessions: async () => ({ findOne: async (query: any) => credentials.find(row => matches(row, query)) ?? null }),
    transaction: async work => work({}), insert: async (_, row) => { records.push(row); }, now: () => time, uuid: () => `id-${++sequence}` });
  const call = (input: any, owner = 'owner') => service(owner, { deviceId: 'device', ...input });
  const enqueue = (requestId = 'request', command: any = { action: 'status' }) => call({ action: 'enqueue', requestId, command });
  return { call, enqueue, records, credentials, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
test('remote requests are protected disposable control Things and never searchable payloads', async () => {
  const f = fixture(); await f.enqueue();
  const row = f.records[1];
  assert.equal(isProtectedThingtime(['device-sync-control']), true);
  assert.ok(EPHEMERAL_CONTROL_THINGTIMES.includes('device-sync-control'));
  assert.ok(DEVICE_CONTROL_THINGTIME.includes('device-sync-control'));
  assert.ok(row.secure instanceof Binary);
  assert.equal(row.crystal.command, undefined);
  assert.equal(row.storageClass, 'control');
});
test('account/device ownership, revocation, and reconnect bind every operation', async () => {
  const f = fixture(); await f.enqueue();
  assert.equal((await f.call({ action: 'poll' }, 'foreign')).ok, false);
  assert.equal((await f.call({ action: 'poll', deviceId: 'other' })).ok, false);
  f.credentials[0].revokedAt = new Date();
  assert.equal((await f.call({ action: 'read', requestId: 'request' })).ok, false);
  f.credentials[0].revokedAt = null; f.credentials[0].jti = 'new-pairing';
  assert.deepEqual(await f.call({ action: 'poll' }), { ok: true, command: null });
  assert.equal((await f.enqueue()).ok, false);
  assert.equal((await f.call({ action: 'read', requestId: 'request' })).ok, false);
});
test('immutable retries and atomic claims never dispatch the same operation twice', async () => {
  const f = fixture();
  assert.equal((await f.enqueue() as any).status, 'pending');
  assert.equal((await f.enqueue() as any).status, 'pending');
  assert.equal(f.records.length, 2);
  assert.equal((await f.enqueue('request', { action: 'pause', connectionId: 'connection' }) as any).status, 409);
  const claims: any[] = await Promise.all([f.call({ action: 'poll' }), f.call({ action: 'poll' })]);
  const claim = claims.find((row: any) => row.command)?.command;
  assert.equal(claims.filter((row: any) => row.command).length, 1);
  assert.equal(claim.id, 'request');
  assert.deepEqual(claim.command, { action: 'status' });
  assert.equal((await f.call({ action: 'complete', requestId: 'request', leaseId: 'wrong', result: {} }) as any).status, 409);
  assert.equal((await f.call({ action: 'complete', requestId: 'request', leaseId: claim.leaseId, result: { roots: [] } }) as any).status, 'complete');
  assert.deepEqual((await f.call({ action: 'read', requestId: 'request' }) as any).result, { roots: [] });
  const replay: any = await f.call({ action: 'complete', requestId: 'request', leaseId: claim.leaseId, result: { roots: ['changed'] } });
  assert.deepEqual(replay.result, { roots: [] });
});
test('expired requests cannot execute, complete, disclose results, or be revived by retry', async () => {
  const f = fixture(); await f.enqueue();
  const claim: any = await f.call({ action: 'poll' });
  f.advance(DEVICE_SYNC_REQUEST_MS);
  assert.equal((await f.enqueue() as any).status, 'expired');
  assert.equal((await f.call({ action: 'complete', requestId: 'request', leaseId: claim.command.leaseId, result: {} }) as any).status, 'expired');
  assert.equal((await f.call({ action: 'read', requestId: 'request' }) as any).status, 'expired');
  assert.deepEqual(await f.call({ action: 'poll' }), { ok: true, command: null });
});
test('backpressure and closed request vocabulary reject overflow and file transport', async () => {
  const f = fixture();
  for (let i = 0; i < 16; i++) await f.enqueue(`pending-${i}`);
  assert.equal((await f.enqueue('overflow') as any).status, 429);
  assert.equal((await f.call({ action: 'enqueue', requestId: 'forged', ownerId: 'foreign', command: { action: 'status' } }) as any).status, 400);
  assert.equal((await f.enqueue('bytes', { action: 'folders', request: { action: 'read', rootId: 'root', path: 'secret' } }) as any).status, 400);
  assert.equal((await f.call({ action: 'complete', requestId: 'pending-0', leaseId: 'lease', result: 'x'.repeat(REMOTE_SYNC_RESULT_BYTES) }) as any).status, 413);
});
