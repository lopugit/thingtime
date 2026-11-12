import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_THING_STORAGE_POLICY, THING_DEVICE_STORAGE_POLICY_KIND, THING_STORAGE_POLICY_INDEX_KIND, THING_STORAGE_POLICY_KIND,
  type AutomaticThingStoragePolicyPage, type AutomaticThingStorageRule,
  type ThingDeviceStoragePolicy, type ThingStorageDevice, type ThingStoragePolicy, type ThingStoragePolicyResponse,
  type ThingStorageSource, type UpdateThingStoragePolicy
} from '../../../utils/thingStoragePolicy';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS, isProtectedThingtime, MESSENGER_THINGTIME, SUBSPACE_THINGTIME, UPDOWN_THINGTIME } from '../../../schemas/registry';
import { deviceExistsForOwner } from '../devices/devices';
import { getHomeThingsCollection, getSessionsCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { StorageMutationError } from '../storage/storageCore';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { findThingMetadataSource, isFail, type Fail, type ThingDoc, type Viewer } from './things';
import { measureThingJson } from './thingMetadataCore';
import { isStorageBrowserId } from './thingStoragePolicyCore';

export const storagePolicyFail = (status: number, error: string): Fail => ({ ok: false, status, error });
const notFound = () => storagePolicyFail(404, 'Thing not found');
const conflict = () => storagePolicyFail(409, 'The Thing or storage policy changed. Refresh and try again.');
const unavailable = () => storagePolicyFail(503, 'Thing storage policy is temporarily unavailable');
const nonce = () => randomBytes(16).toString('hex');
const kindsWithSeparateLifecycle = new Set<string>([...MESSENGER_THINGTIME, ...SUBSPACE_THINGTIME, UPDOWN_THINGTIME]);
type Collection = Awaited<ReturnType<typeof getHomeThingsCollection>>;
type PolicyDeviceContext = { requestedId?: string; browser: ThingStorageDevice | null };

export const storagePolicySource = (source: ThingDoc, signal?: AbortSignal): ThingStorageSource => {
  const { sourceHash } = measureThingJson(source, () => signal?.throwIfAborted());
  // File commits have their own immutable, revision-fenced publication. Its
  // revision is the same value the Files route and native receipts verify.
  const revision = source.thingtime?.length === 1 && source.thingtime[0] === 'file' && source.timelineHeadId
    ? source.timelineHeadId
    : createHash('sha256').update(JSON.stringify([source.timelineHeadId ?? null, source.updatedAt, sourceHash])).digest('hex');
  return { id: source.shareId, revision, sourceHash };
};

const canPersistFor = (source: ThingDoc) => {
  const kinds = source.thingtime ?? [];
  // These stable File roots retain a canonical history through trash. Other
  // managed families need their own policy lifecycle and local adapter.
  return (kinds.length === 1 && kinds[0] === 'file') ||
    (!isProtectedThingtime(kinds) && !kinds.some(kind => kindsWithSeparateLifecycle.has(kind)));
};

async function authorizedDevice(ownerId: string, context: PolicyDeviceContext, session?: any): Promise<ThingStorageDevice | null | Fail> {
  const id = context.requestedId;
  if (!id || context.browser?.id === id) return context.browser;
  // A browser ID is valid only when presented through its signed HttpOnly
  // credential; an arbitrary submitted ID cannot select that scope.
  if (isStorageBrowserId(id) || !(await deviceExistsForOwner(ownerId, id, session))) return storagePolicyFail(404, 'Storage device not found');
  const sessions = await getSessionsCollection();
  const live = await sessions.findOne({ purpose: 'device', userId: ownerId, 'meta.deviceId': id, revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] }, { ...(session ? { session } : {}), projection: { _id: 1 } });
  return live ? { id, kind: 'paired' } : storagePolicyFail(404, 'Storage device not found');
}

const rowKey = (ownerId: string, targetId: string, deviceId?: string) => JSON.stringify([ownerId, targetId, deviceId ?? null]);
const rowKind = (deviceId?: string) => deviceId ? THING_DEVICE_STORAGE_POLICY_KIND : THING_STORAGE_POLICY_KIND;
const rowFilter = (ownerId: string, targetId: string, deviceId?: string) => ({
  ...thingUniqueKeyFilter(rowKind(deviceId), rowKey(ownerId, targetId, deviceId)),
  thingtime: [rowKind(deviceId)], ownerId, targetId, storageClass: 'control',
  ...(deviceId ? { 'crystal.deviceId': deviceId } : {})
});
export async function automaticThingCloudSyncAllowed(things: Collection, ownerId: string, targetId: string, session?: any): Promise<boolean> {
  const row = await things.findOne(rowFilter(ownerId, targetId), { ...(session ? { session } : {}), projection: { 'crystal.cloudSync': 1 } });
  return row?.crystal.cloudSync !== false;
}
export async function assertThingStorageCloudWrite(things: Collection, ownerId: string, targetId: string,
  expectedRevision: string | null, session: any) {
  const row = await things.findOne(rowFilter(ownerId, targetId), { session, projection: { crystal: 1 } });
  if (row?.crystal.cloudSync === false)
    throw new StorageMutationError(409, 'storage_conflict', 'Cloud sync is paused for this Thing');
  if ((row?.crystal.revision ?? null) !== expectedRevision)
    throw new StorageMutationError(409, 'storage_conflict', 'The storage policy changed. Refresh and try again.');
}
const revisionFilter = (ownerId: string) => ({
  ...thingUniqueKeyFilter(THING_STORAGE_POLICY_INDEX_KIND, ownerId), ownerId, thingtime: [THING_STORAGE_POLICY_INDEX_KIND]
});

async function readPolicyRevision(things: Collection, ownerId: string, signal?: AbortSignal): Promise<string | null> {
  const row = await things.findOne(revisionFilter(ownerId), { projection: { 'crystal.revision': 1 }, ...(signal ? { signal } : {}) });
  return row?.crystal.revision ?? null;
}

async function advancePolicyRevision(things: Collection, ownerId: string, session: any) {
  const now = new Date(), kind = THING_STORAGE_POLICY_INDEX_KIND;
  await things.updateOne(revisionFilter(ownerId), {
    $set: { 'crystal.revision': nonce(), updatedAt: now },
    $setOnInsert: { shareId: `${kind}-${nonce()}`, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
      uniqueKeys: [thingUniqueKey(kind, ownerId)], acl: [ACL_OWNER], storageClass: 'control', tags: [], createdAt: now }
  }, { session, upsert: true });
}

export async function readAutomaticThingStorageRules(ownerId: string, deviceId: string, cursor: string | null,
  expectedRevision: string | null | undefined, signal?: AbortSignal): Promise<AutomaticThingStoragePolicyPage | Fail> {
  if (isCustomMongoEndpointActive()) return storagePolicyFail(409, 'Automatic placement requires the home data plane');
  try {
    const device = await authorizedDevice(ownerId, { requestedId: deviceId, browser: null });
    if (isFail(device)) return device;
    const things = await getHomeThingsCollection();
    const revision = await readPolicyRevision(things, ownerId, signal);
    if (cursor && revision !== expectedRevision) return conflict();
    if (!cursor && revision === expectedRevision) return { ok: true, revision, unchanged: true, rules: [], nextCursor: null };
    const pageSize = 64;
    const documents = await things.find({ ownerId, storageClass: 'control', ...(cursor ? { targetId: { $gt: cursor } } : {}),
      $or: [{ thingtime: [THING_STORAGE_POLICY_KIND] }, { thingtime: [THING_DEVICE_STORAGE_POLICY_KIND], 'crystal.deviceId': deviceId }] },
      { projection: { targetId: 1, thingtime: 1, crystal: 1 }, ...(signal ? { signal } : {}) }).sort({ targetId: 1 }).limit(pageSize * 2 + 1).toArray();
    const byId = new Map<string, AutomaticThingStorageRule>();
    for (const doc of documents) {
      let rule = byId.get(doc.targetId);
      if (!rule) {
        if (byId.size > pageSize) break;
        rule = { id: doc.targetId, cloudSync: true, defaultLocalAvailability: 'inherit', automaticDownloadDeviceId: null, localAvailability: 'inherit' };
        byId.set(rule.id, rule);
      }
      if (doc.thingtime[0] === THING_STORAGE_POLICY_KIND) {
        rule.cloudSync = doc.crystal.cloudSync;
        rule.defaultLocalAvailability = doc.crystal.defaultLocalAvailability;
        rule.automaticDownloadDeviceId = doc.crystal.automaticDownloadDeviceId;
      } else rule.localAvailability = doc.crystal.localAvailability;
    }
    if (await readPolicyRevision(things, ownerId, signal) !== revision) return conflict();
    const rules = [...byId.values()];
    const nextCursor = rules.length > pageSize ? rules[pageSize - 1].id : null;
    return { ok: true, revision, rules: rules.slice(0, pageSize), nextCursor };
  } catch { return unavailable(); }
}

async function readPolicyRows(things: Collection, ownerId: string, targetId: string, device: ThingStorageDevice | null, session?: any) {
  // Session operations are sequential. The same Mongo transaction may never
  // issue overlapping driver calls through Promise.all.
  const options = session ? { session } : {};
  const policyRow = await things.findOne(rowFilter(ownerId, targetId), options);
  const deviceRow = device ? await things.findOne(rowFilter(ownerId, targetId, device.id), options) : null;
  const policy: ThingStoragePolicy = policyRow ? {
    revision: policyRow.crystal.revision, cloudSync: policyRow.crystal.cloudSync,
    defaultLocalAvailability: policyRow.crystal.defaultLocalAvailability, automaticDownloadDeviceId: policyRow.crystal.automaticDownloadDeviceId
  } : { ...DEFAULT_THING_STORAGE_POLICY };
  const devicePolicy: ThingDeviceStoragePolicy | null = device ? {
    ...device, revision: deviceRow?.crystal.revision ?? null, localAvailability: deviceRow?.crystal.localAvailability ?? 'inherit'
  } : null;
  return { policy, devicePolicy, policyRow, deviceRow };
}

export async function readThingStoragePolicy(viewer: Viewer, id: string, ownerSession: boolean, context: PolicyDeviceContext, signal?: AbortSignal): Promise<ThingStoragePolicyResponse | Fail> {
  try {
    const source = await findThingMetadataSource(id, viewer);
    if (!source) return notFound();
    const projection = storagePolicySource(source, signal);
    if (!ownerSession || !viewer?.id || source.ownerId !== viewer.id || isCustomMongoEndpointActive() || !canPersistFor(source))
      return { ok: true, source: projection, policy: { ...DEFAULT_THING_STORAGE_POLICY }, device: null, canEdit: false };
    const device = await authorizedDevice(viewer.id, context);
    if (isFail(device)) return device;
    const rows = await readPolicyRows(await getHomeThingsCollection(), viewer.id, id, device);
    return { ok: true, source: projection, policy: rows.policy, device: rows.devicePolicy, canEdit: true };
  } catch { return unavailable(); }
}

async function writeRow(things: Collection, session: any, ownerId: string, targetId: string, crystal: Record<string, unknown>, existingId?: any, deviceId?: string) {
  const now = new Date();
  if (existingId) {
    const result = await things.updateOne({ _id: existingId }, { $set: { crystal, updatedAt: now } }, { session });
    if (result.matchedCount !== 1) throw Error('Storage policy row was lost');
    return;
  }
  const kind = rowKind(deviceId);
  await things.insertOne({ shareId: `${kind}-${nonce()}`, ownerId, targetId, thingtime: [kind],
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, uniqueKeys: [thingUniqueKey(kind, rowKey(ownerId, targetId, deviceId))],
    acl: [ACL_OWNER], storageClass: 'control', crystal, tags: [], createdAt: now, updatedAt: now }, { session });
}

export async function updateThingStoragePolicy(viewer: Viewer, input: UpdateThingStoragePolicy, browser: ThingStorageDevice | null, signal?: AbortSignal): Promise<ThingStoragePolicyResponse | Fail> {
  if (!viewer?.id || viewer.pat) return storagePolicyFail(401, 'A full user session is required');
  if (isCustomMongoEndpointActive()) return storagePolicyFail(409, 'Saving storage policy requires the home data plane');
  try {
    const ownerId = viewer.id, things = await getHomeThingsCollection();
    return await withHomeMongoTransaction(async session => {
      const source = await findThingMetadataSource(input.id, viewer, session);
      if (!source || source.ownerId !== ownerId) return notFound();
      if (!canPersistFor(source)) return storagePolicyFail(409, 'Storage policy cannot be saved for this managed Thing kind');
      const projection = storagePolicySource(source, signal);
      if (input.expectedSourceRevision !== projection.revision) return conflict();
      const device = await authorizedDevice(ownerId, { requestedId: input.deviceId, browser }, session);
      if (isFail(device)) return device;
      if (input.localAvailability !== undefined && !device) return storagePolicyFail(409, 'Choose a verified storage device first');
      const automaticDevice = input.policy?.automaticDownloadDeviceId;
      if (automaticDevice && automaticDevice !== device?.id) return storagePolicyFail(400, 'Automatic downloads can be pinned only to the verified device');
      const { policy, devicePolicy, policyRow, deviceRow } = await readPolicyRows(things, ownerId, source.shareId, device, session);
      if (policy.revision !== input.expectedPolicyRevision ||
          (input.expectedDeviceRevision !== undefined && input.expectedDeviceRevision !== (devicePolicy?.revision ?? null))) return conflict();
      const nextPolicy = { ...policy, ...input.policy };
      const nextDevice = devicePolicy && input.localAvailability !== undefined ? { ...devicePolicy, localAvailability: input.localAvailability } : devicePolicy;
      const changePolicy = nextPolicy.cloudSync !== policy.cloudSync || nextPolicy.defaultLocalAvailability !== policy.defaultLocalAvailability ||
        nextPolicy.automaticDownloadDeviceId !== policy.automaticDownloadDeviceId;
      const changeDevice = !!nextDevice && nextDevice.localAvailability !== devicePolicy?.localAvailability;
      if (changePolicy || changeDevice) {
        signal?.throwIfAborted();
        // A real source write participates in the same transaction, so a
        // concurrent edit or cascade cannot strand a stale control child.
        const fenced = await things.updateOne({ _id: source._id, ownerId }, { $set: { storagePolicyFence: nonce() } }, { session });
        if (fenced.matchedCount !== 1) return conflict();
        if (changePolicy) {
          nextPolicy.revision = nonce();
          await writeRow(things, session, ownerId, source.shareId, nextPolicy, policyRow?._id);
        }
        if (changeDevice && nextDevice) {
          nextDevice.revision = nonce();
          await writeRow(things, session, ownerId, source.shareId, {
            deviceId: nextDevice.id, revision: nextDevice.revision, localAvailability: nextDevice.localAvailability
          }, deviceRow?._id, nextDevice.id);
        }
        await advancePolicyRevision(things, ownerId, session);
      }
      return { ok: true as const, source: projection, policy: nextPolicy, device: nextDevice, canEdit: true };
    });
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return conflict();
    return unavailable();
  }
}
