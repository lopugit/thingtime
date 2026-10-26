import { createHash, randomUUID } from 'node:crypto';
import { Binary } from 'mongodb';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { thingUniqueKeyFilter, thingUniqueKeys } from '../mongodb/uniqueKeys';
import { insertAccountedThing } from '../storage/accountedThings';
import { validateRemoteSyncCommand, REMOTE_SYNC_RESULT_BYTES } from '~/fileSync/remoteSyncProtocol';

export const DEVICE_SYNC_CONTROL_KIND = 'device-sync-control';
export const DEVICE_SYNC_REQUEST_MS = 120_000;
// Keep the small operation identity after its execution deadline so a delayed
// retry cannot execute it again. These disposable control records use shared TTL.
const RETENTION_MS = 10 * 60_000;
const QUEUE_BACKPRESSURE = 16;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (status: number, error: string) => ({ ok: false as const, status, error });
const payload = (row: any): any => {
  if (!(row?.secure instanceof Binary) || row.secure.length() > REMOTE_SYNC_RESULT_BYTES + 1024) throw Error('Invalid sync control payload');
  return JSON.parse(Buffer.from(row.secure.value()).toString('utf8'));
};
const encode = (value: unknown) => new Binary(Buffer.from(JSON.stringify(value)));
const expired = () => ({ ok: true as const, status: 'expired', error: 'The device did not confirm this request in time. Refresh its status before trying again.' });
export const publicDeviceSyncControl = (row: any, now: Date) => {
  if (new Date(row.crystal.deadlineAt).getTime() <= now.getTime()) return expired();
  const status = row.crystal.status as string;
  return { ok: true as const, status, ...(status === 'complete' ? { result: payload(row).result } : status === 'error' ? { error: payload(row).error } : {}) };
};

type Dependencies = {
  things(): Promise<any>; sessions(): Promise<any>;
  transaction<T>(work: (session: any) => Promise<T>): Promise<T>;
  insert(things: any, row: any, options: any): Promise<any>;
  now(): Date; uuid(): string;
};
const defaults: Dependencies = { things: getHomeThingsCollection, sessions: getSessionsCollection,
  transaction: withHomeMongoTransaction, insert: insertAccountedThing, now: () => new Date(), uuid: randomUUID };

/** The worker is an authenticated installed renderer. This mailbox grants no
 * native permission: it reauthorizes its exact local device before dispatch. */
export function createDeviceSyncControlService(overrides: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...overrides };
  return async (ownerId: string, input: any) => {
    if (!input || !validId(input.deviceId)) return fail(400, 'A valid deviceId is required');
    const action = input.action;
    const keys: Record<string, string[]> = { read: ['action', 'deviceId', 'requestId'], enqueue: ['action', 'deviceId', 'requestId', 'command'],
      poll: ['action', 'deviceId'], complete: ['action', 'deviceId', 'requestId', 'leaseId', 'result', 'error'] };
    if (!Object.prototype.hasOwnProperty.call(keys, action) || Object.keys(input).some(key => !keys[action].includes(key))) return fail(400, 'Invalid sync control request');
    if (action !== 'poll' && !validId(input.requestId)) return fail(400, 'A valid requestId is required');
    let command: ReturnType<typeof validateRemoteSyncCommand> | undefined;
    if (action === 'enqueue') {
      try { command = validateRemoteSyncCommand(input.command); } catch { return fail(400, 'Invalid remote sync command'); }
    }
    if (action === 'complete') {
      if (!validId(input.leaseId) || ('error' in input) === ('result' in input) ||
        ('error' in input && (typeof input.error !== 'string' || !input.error || input.error.length > 512))) return fail(400, 'Invalid sync control completion');
      try { if (Buffer.byteLength(JSON.stringify('error' in input ? { error: input.error } : { result: input.result })) > REMOTE_SYNC_RESULT_BYTES)
        return fail(413, 'This sync response needs a smaller page'); } catch { return fail(400, 'Invalid sync control completion'); }
    }
    const things = await deps.things(), sessions = await deps.sessions(), now = deps.now();
    const deviceFilter = { shareId: input.deviceId, thingtime: 'device', ownerId };
    const device = await things.findOne(deviceFilter);
    const paired = device && await sessions.findOne({ purpose: 'device', userId: ownerId, 'meta.deviceId': input.deviceId,
      revokedAt: null, expiresAt: { $gt: now } });
    if (!paired) return fail(404, 'Paired device not found');
    const pairingHash = hash(paired.jti);
    const scope = { thingtime: DEVICE_SYNC_CONTROL_KIND, ownerId, targetId: input.deviceId, 'crystal.deviceCommandKey': { $type: 'string' } };
    const identity = { ...scope, ...thingUniqueKeyFilter('deviceUniqueKey', hash(['sync-control', ownerId, input.deviceId, input.requestId])) };
    if (action === 'read') {
      const row = await things.findOne(identity);
      return row ? row.crystal.pairingHash === pairingHash ? publicDeviceSyncControl(row, now) : fail(409, 'The device connection changed') : fail(404, 'Sync request not found');
    }
    if (action === 'enqueue') {
      return deps.transaction(async session => {
        // Existing device row is the same quota-neutral transaction fence used
        // by device control-event admission. It serializes queue backpressure.
        const locked = await things.updateOne(deviceFilter, { $currentDate: { updatedAt: true } }, { session });
        if (!locked.matchedCount) return fail(404, 'Paired device not found');
        const existing = await things.findOne(identity, { session });
        const digest = hash(command);
        if (existing && existing.crystal.pairingHash !== pairingHash) return fail(409, 'The device connection changed');
        if (existing) return existing.crystal.digest === digest ? publicDeviceSyncControl(existing, now) : fail(409, 'requestId was already used for different sync work');
        const waiting = await things.countDocuments({ ...scope, 'crystal.status': { $in: ['pending', 'processing'] }, 'crystal.deadlineAt': { $gt: now } }, { session, limit: QUEUE_BACKPRESSURE });
        if (waiting >= QUEUE_BACKPRESSURE) return fail(429, 'The device has pending sync requests. Wait for it to reconnect before retrying.');
        const row = { shareId: deps.uuid(), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: [DEVICE_SYNC_CONTROL_KIND],
          ownerId, targetId: input.deviceId, acl: ['tt:user'], storageClass: 'control',
          uniqueKeys: thingUniqueKeys('deviceUniqueKey', [hash(['sync-control', ownerId, input.deviceId, input.requestId])]),
          crystal: { deviceCommandKey: hash(['sync-control', ownerId, input.deviceId, input.requestId]), pairingHash, requestId: input.requestId, digest, status: 'pending', deadlineAt: new Date(now.getTime() + DEVICE_SYNC_REQUEST_MS) },
          secure: encode({ command }), createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + RETENTION_MS) };
        await deps.insert(things, row, { session, accountedPlane: 'home' });
        return publicDeviceSyncControl(row, now);
      });
    }
    if (action === 'poll') {
      const leaseId = deps.uuid();
      const row = await things.findOneAndUpdate({ ...scope, 'crystal.pairingHash': pairingHash, 'crystal.status': 'pending', 'crystal.deadlineAt': { $gt: now } },
        { $set: { 'crystal.status': 'processing', 'crystal.leaseHash': hash(leaseId), updatedAt: now } },
        { sort: { createdAt: 1, shareId: 1 }, returnDocument: 'after', includeResultMetadata: false });
      return { ok: true as const, command: row ? { id: row.crystal.requestId, command: payload(row).command, leaseId, expiresAt: new Date(row.crystal.deadlineAt).toISOString() } : null };
    }
    const result = 'error' in input ? { error: input.error } : { result: input.result };
    const row = await things.findOneAndUpdate({ ...identity, 'crystal.pairingHash': pairingHash, 'crystal.status': 'processing', 'crystal.leaseHash': hash(input.leaseId), 'crystal.deadlineAt': { $gt: now } },
      { $set: { 'crystal.status': 'error' in input ? 'error' : 'complete', secure: encode(result), updatedAt: now } },
      { returnDocument: 'after', includeResultMetadata: false });
    if (row) return publicDeviceSyncControl(row, now);
    const previous = await things.findOne(identity);
    if (!previous) return fail(404, 'Sync request not found');
    if (previous.crystal.pairingHash !== pairingHash) return fail(409, 'The device connection changed');
    if (previous.crystal.leaseHash !== hash(input.leaseId)) return fail(409, 'This worker does not hold the sync request');
    if (new Date(previous.crystal.deadlineAt).getTime() <= now.getTime()) return expired();
    if (['complete', 'error'].includes(previous.crystal.status)) return publicDeviceSyncControl(previous, now);
    return fail(409, 'Sync request is not claimed');
  };
}
export const deviceSyncControl = createDeviceSyncControlService();
