import { MONGO_CONNECTION_FEATURES, type MongoConnectionInventory, type MongoConnectionSource, type MongoConnectionPool } from '../../../mongodb/connectionInventory';
import { COLLECTION_SCHEMA_VERSIONS } from '../../../schemas/registry';
import { getExistingHomeMongoDb, getExistingHomeConnectionSnapshotCollection, getHomeThingsCollection } from './collections';
import { THINGS_CREATED_ORDER } from './thingIndexContracts';
import { CONNECTION_SNAPSHOT_THINGTIME, CONNECTION_SNAPSHOT_FRESH_MS, CONNECTION_SNAPSHOT_RETENTION_MS, connectionDeployment, mongoConnectionTracker, safeConnectionAddress } from './connectionTracker';

const OPERATION_TIMEOUT_MS = 1500;
const PUBLISH_INTERVAL_MS = 60_000;
const sourceId = (value: unknown): value is string => typeof value === 'string' && /^mongodb-connection-snapshot-[a-f0-9-]{36}$/.test(value);
const date = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const validCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const count = (value: unknown): number => validCount(value) ? value : 0;
const nullableCount = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
const selected = <T extends string>(value: unknown, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;

/** Re-project even server-minted stored telemetry. No object spreads from stored documents. */
export const projectConnectionSource = (input: any, now: number, runtimeId: string): MongoConnectionSource | null => {
  if (!input || !sourceId(input.id) || typeof input.runtimeId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.runtimeId)) return null;
  const startedAt = date(input.startedAt), observedAt = date(input.observedAt);
  if (!startedAt || !observedAt) return null;
  if (!Array.isArray(input.pools) || input.pools.some((pool: any) => !pool || ['open', 'pending', 'checkedOut', 'created', 'closed', 'cleared'].some(key => !validCount(pool[key])))) return null;
  const purpose = input.purpose === 'home' ? 'home' : 'custom';
  const pools: MongoConnectionPool[] = (Array.isArray(input.pools) ? input.pools : []).map((pool: any, index: number) => ({
    id: `${input.id}:pool-${index + 1}`, address: purpose === 'home' ? safeConnectionAddress(pool?.address) : null,
    status: selected(pool?.status, ['ready', 'paused', 'closed'], 'paused'), open: count(pool?.open), pending: count(pool?.pending), checkedOut: Math.min(count(pool?.checkedOut), count(pool?.open)),
    created: count(pool?.created), closed: count(pool?.closed), cleared: count(pool?.cleared), maxPoolSize: nullableCount(pool?.maxPoolSize), minPoolSize: nullableCount(pool?.minPoolSize), maxIdleTimeMS: nullableCount(pool?.maxIdleTimeMS), maxConnecting: nullableCount(pool?.maxConnecting), waitQueueTimeoutMS: nullableCount(pool?.waitQueueTimeoutMS)
  }));
  const status = selected(input.status, ['connecting', 'ready', 'closed', 'failed'], 'failed');
  const monitoringMode = selected(input.monitoring?.mode, ['poll', 'stream', 'auto', 'load-balanced', 'unknown'], 'unknown');
  const rawServers = nullableCount(input.monitoring?.servers);
  const servers = rawServers !== null && rawServers <= Number.MAX_SAFE_INTEGER / 2 ? rawServers : null;
  const monitoring = input.monitoring && servers !== null ? { mode: monitoringMode, servers,
    socketsUpperBound: status === 'ready' && monitoringMode !== 'unknown' && servers > 0 ? servers * (monitoringMode === 'load-balanced' ? 0 : monitoringMode === 'poll' ? 1 : 2) : null, basis: 'topology-model' as const } : undefined;
  const featureUsage = Array.isArray(input.featureUsage) ? MONGO_CONNECTION_FEATURES.flatMap(feature => {
    const row = input.featureUsage.find((row: any) => row?.feature === feature);
    const lastUsedAt = date(row?.lastUsedAt);
    return row && validCount(row.accesses) && lastUsedAt ? [{ feature, accesses: row.accesses, lastUsedAt }] : [];
  }) : undefined;
  return {
    id: input.id, runtimeId: input.runtimeId, startedAt, observedAt,
    freshness: input.runtimeId === runtimeId ? 'current' : now - Date.parse(observedAt) <= CONNECTION_SNAPSHOT_FRESH_MS ? 'recent' : 'stale',
    purpose, status, monitoring, featureUsage, appName: purpose === 'home' ? 'thingtime-api' : 'thingtime-api-custom',
    reason: purpose === 'home' ? 'Shared home client for API identity, control and default content operations.' : 'Bounded cached client for a request-selected custom data plane; private endpoint details are withheld.',
    createdBy: 'Thingtime API runtime', deployment: connectionDeployment({ VERCEL_ENV: input.deployment?.environment, VERCEL_GIT_COMMIT_REF: input.deployment?.branch, VERCEL_GIT_COMMIT_SHA: input.deployment?.commit, VERCEL_URL: input.deployment?.url, VERCEL_REGION: input.deployment?.region, VERCEL_DEPLOYMENT_ID: input.deployment?.deploymentId }),
    pools, totals: pools.reduce((sum, pool) => ({ open: sum.open + pool.open, checkedOut: sum.checkedOut + pool.checkedOut, created: sum.created + pool.created, closed: sum.closed + pool.closed }), { open: 0, checkedOut: 0, created: 0, closed: 0 })
  };
};

export const buildConnectionSnapshotThing = (source: MongoConnectionSource, now: number) => ({
  shareId: source.id, schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
  thingtime: [CONNECTION_SNAPSHOT_THINGTIME], storageClass: 'control', ownerId: 'tt:system:mongodb-connections', acl: [], targetId: null,
  tags: [CONNECTION_SNAPSHOT_THINGTIME], crystal: { source }, createdAt: new Date(source.startedAt), updatedAt: new Date(now), expiresAt: new Date(now + CONNECTION_SNAPSHOT_RETENTION_MS)
});

export const createConnectionSnapshotPublisher = (dependencies: {
  now: () => number; snapshot: () => MongoConnectionSource[]; available: () => Promise<unknown>;
  collection: () => Promise<any>; pruneClosed: (ids: string[]) => void;
}) => {
  let lastAttempt: number | null = null;
  let pending: Promise<boolean> | null = null;
  return (force = false): Promise<boolean> => {
    if (pending) return pending;
    const now = dependencies.now();
    if (!force && lastAttempt !== null && now - lastAttempt < PUBLISH_INTERVAL_MS) return Promise.resolve(false);
    const sources = dependencies.snapshot();
    if (!sources.length) return Promise.resolve(false);
    lastAttempt = now;
    const deadline = now + OPERATION_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = (async () => {
      // Both checks precede storage access. Followers and cold workers never dial for telemetry.
      if (!await dependencies.available() || dependencies.now() >= deadline) return false;
      const collection = await dependencies.collection();
      if (dependencies.now() >= deadline) return false;
      await collection.bulkWrite(sources.map(source => {
        const { createdAt, ...doc } = buildConnectionSnapshotThing(source, now);
        return { updateOne: { filter: { shareId: source.id, thingtime: CONNECTION_SNAPSHOT_THINGTIME }, update: { $set: doc, $setOnInsert: { createdAt } }, upsert: true } };
      }), { ordered: false, timeoutMS: Math.max(1, deadline - dependencies.now()) });
      dependencies.pruneClosed(sources.filter(source => source.status === 'closed' || source.status === 'failed').map(source => source.id));
      return true;
    })().catch(() => false);
    pending = Promise.race([operation, new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), OPERATION_TIMEOUT_MS); })]).finally(() => { clearTimeout(timer); pending = null; });
    return pending;
  };
};

// No timer: awaited once at the end of an already executing API request. Idle
// or frozen workers do not wake up, and deployments are never visited to sample them.
export const publishMongoConnectionSnapshots = createConnectionSnapshotPublisher({ now: Date.now, snapshot: mongoConnectionTracker.snapshot,
  available: getExistingHomeMongoDb, collection: getExistingHomeConnectionSnapshotCollection, pruneClosed: mongoConnectionTracker.pruneClosed });

export type ConnectionInventoryPage = { cursor?: { at: string; id: string } | null; limit?: number };
export const decodeConnectionInventoryCursor = (value: string | null): { at: string; id: string } | null => {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!date(parsed.at) || !sourceId(parsed.id)) throw new Error();
    return { at: new Date(parsed.at).toISOString(), id: parsed.id };
  } catch { throw new TypeError('Invalid connection inventory cursor'); }
};
export const boundedConnectionInventoryPageSize = (value: string | null) => value && /^\d+$/.test(value) ? Math.max(1, Math.min(200, Number(value))) : 50;

export const readServerConnectionTotals = async (db: any, checkedAt: string): Promise<Pick<MongoConnectionInventory, 'server'> & { counts: Pick<MongoConnectionInventory['totals'], 'serverCurrent' | 'serverAvailable' | 'serverTotalCreated'> }> => {
  const unknown = { serverCurrent: null, serverAvailable: null, serverTotalCreated: null };
  if (!db) return { server: { status: 'unavailable', checkedAt, note: 'No existing home client is available; diagnostics did not open one.' }, counts: unknown };
  try {
    const result = await db.admin().command({ serverStatus: 1, connections: 1, maxTimeMS: OPERATION_TIMEOUT_MS }, { timeoutMS: OPERATION_TIMEOUT_MS });
    const counts = { serverCurrent: nullableCount(result?.connections?.current), serverAvailable: nullableCount(result?.connections?.available), serverTotalCreated: nullableCount(result?.connections?.totalCreated) };
    return { counts, server: { status: counts.serverCurrent === null ? 'unsupported' : 'available', checkedAt,
      note: counts.serverCurrent === null ? 'MongoDB did not provide connection totals on this tier or permission set.' : 'MongoDB serverStatus totals for the selected home server, including clients not instrumented here. This is not a cluster-wide total.' } };
  } catch (error: any) {
    return { counts: unknown, server: { status: [13, 59, 115, 8000].includes(error?.code) ? 'unsupported' : 'unavailable', checkedAt,
      note: 'MongoDB aggregate diagnostics are unavailable or refused by this tier or permission set; application snapshots remain usable.' } };
  }
};

export const createConnectionInventoryReader = (dependencies = {
  now: Date.now, runtimeId: mongoConnectionTracker.runtimeId, local: mongoConnectionTracker.snapshot,
  publish: publishMongoConnectionSnapshots, collection: getHomeThingsCollection, existingDb: getExistingHomeMongoDb
}) => async ({ cursor = null, limit = 50 }: ConnectionInventoryPage = {}): Promise<MongoConnectionInventory> => {
  const now = dependencies.now(), checkedAt = new Date(now).toISOString();
  const notes = [
    'Counts below sum the sources on this page at their observation times, including stale snapshots; they are not a live database or deployment total.',
    'CMAP measures application pool sockets. Monitoring sockets are not measured: the optional topology model is an upper bound based on current server count and configured driver monitoring mode; auto/stream allows up to two per server, poll up to one, load-balanced zero. It is not a MongoDB total.',
    'Feature usage counts requests acquiring each shared client, once per source per request, grouped by canonical API registry domain. Features share pools: sockets cannot be exclusively assigned to a feature. Legacy snapshots have no usage/model evidence.',
    'Snapshots publish on ordinary API requests at most once per minute and expire after 24 hours. Recent means observed within two minutes; frozen or terminated workers may leave stale counts.',
    'Runtime means a warm process, not a user. The creator is the Thingtime API runtime; request user identities, commands and custom endpoint addresses are never collected.'
  ];
  const published = await dependencies.publish(true);
  if (!published) notes.push('This runtime could not persist its latest snapshot; local observations may be newer than other workers can read.');
  let sources: MongoConnectionSource[] = [], nextCursor: string | null = null;
  const local = new Map(dependencies.local().map(row => [row.id, row]));
  try {
    const collection = await dependencies.collection();
    const pageQuery: any = { thingtime: CONNECTION_SNAPSHOT_THINGTIME, expiresAt: { $gt: new Date(now) } };
    if (cursor) pageQuery.$or = [{ createdAt: { $lt: new Date(cursor.at) } }, { createdAt: new Date(cursor.at), shareId: { $gt: cursor.id } }];
    const docs = await collection.find(pageQuery, { projection: { shareId: 1, createdAt: 1, 'crystal.source': 1 }, timeoutMS: OPERATION_TIMEOUT_MS })
      .sort(THINGS_CREATED_ORDER).limit(limit + 1).toArray();
    const page = docs.slice(0, limit);
    sources = page.map((doc: any) => projectConnectionSource(local.get(doc.shareId) || doc.crystal?.source, now, local.has(doc.shareId) ? dependencies.runtimeId : '')).filter((source: MongoConnectionSource | null): source is MongoConnectionSource => source !== null);
    if (sources.length < page.length) notes.push('Some stored observations were malformed and were omitted; their counts are unknown.');
    if (docs.length > limit && page.length) {
      const last = page[page.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ at: new Date(last.createdAt).toISOString(), id: last.shareId })).toString('base64url');
    }
    if (!cursor && !published) sources = [...local.values(), ...sources.filter(row => !local.has(row.id))];
  } catch {
    sources = cursor ? [] : [...local.values()];
    notes.push('Shared snapshot storage could not be read. Only this process is shown; retry is required for other runtime sources.');
  }
  const server = await readServerConnectionTotals(await dependencies.existingDb().catch(() => null), checkedAt);
  return { checkedAt, sources, nextCursor, totals: {
    observedOpen: sources.reduce((sum, row) => sum + row.totals.open, 0), observedCheckedOut: sources.reduce((sum, row) => sum + row.totals.checkedOut, 0),
    freshSources: sources.filter(row => row.freshness !== 'stale').length, staleSources: sources.filter(row => row.freshness === 'stale').length, ...server.counts
  }, server: server.server, coverage: { complete: false, notes } };
};
export const readMongoConnectionInventory = createConnectionInventoryReader();
