import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { MONGO_CONNECTION_FEATURES, type MongoConnectionFeature, type MongoConnectionPool, type MongoConnectionSource } from '../../../mongodb/connectionInventory';

import { MONGODB_CONNECTION_SNAPSHOT_ID_PREFIX as CONNECTION_SNAPSHOT_PREFIX } from '../../../schemas/registry';
export { MONGODB_CONNECTION_SNAPSHOT_THINGTIME as CONNECTION_SNAPSHOT_THINGTIME, MONGODB_CONNECTION_SNAPSHOT_ID_PREFIX as CONNECTION_SNAPSHOT_PREFIX } from '../../../schemas/registry';
export const CONNECTION_SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const CONNECTION_SNAPSHOT_FRESH_MS = 120_000;
const token = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_./:@ -]{1,256}$/.test(value) ? value : null;
export const safeConnectionAddress = (value: unknown): string | null =>
  typeof value === 'string' && /^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(value) ? value : null;
const deploymentUrl = (value: unknown) => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
};
export const connectionDeployment = (env: NodeJS.ProcessEnv = process.env): MongoConnectionSource['deployment'] => ({
  environment: token(env.VERCEL_ENV) || token(env.NODE_ENV) || 'unknown',
  branch: token(env.VERCEL_GIT_COMMIT_REF), commit: typeof env.VERCEL_GIT_COMMIT_SHA === 'string' && /^[a-f0-9]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA) ? env.VERCEL_GIT_COMMIT_SHA : null,
  url: deploymentUrl(env.VERCEL_URL) || (!env.VERCEL && /^\d{1,5}$/.test(env.NITRO_PORT || env.PORT || '') ? deploymentUrl(`http://127.0.0.1:${env.NITRO_PORT || env.PORT}`) : null), region: token(env.VERCEL_REGION), deploymentId: token(env.VERCEL_DEPLOYMENT_ID)
});
// Only canonical registry groups enter this context; no request, path, actor or body is retained.
const featureContext = new AsyncLocalStorage<{ feature: MongoConnectionFeature; touched: Set<string> }>();
export const connectionFeature = (group: unknown): MongoConnectionFeature => {
  if (['webpages', 'components', 'schemas', 'actions', 'builder'].includes(String(group))) return 'builder';
  if (['posts', 'comments', 'reactions', 'feed'].includes(String(group))) return 'feed';
  return (MONGO_CONNECTION_FEATURES as readonly unknown[]).includes(group) ? group as MongoConnectionFeature : 'other';
};
export const runWithMongoConnectionFeature = <T>(group: unknown, work: () => T): T =>
  featureContext.run({ feature: connectionFeature(group), touched: new Set() }, work);
const optionCount = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
type Emitter = { options?: { serverMonitoringMode?: unknown; loadBalanced?: unknown }; on: (name: string, callback: (event: any) => void) => unknown };
type Tracked = { source: MongoConnectionSource; pools: Map<string, { view: MongoConnectionPool; open: Set<string>; pending: Set<string>; checkedOut: Set<string> }> };

/** Listeners attach before connect. No URI, command, user identity or error payload is retained. */
export const createConnectionTracker = (options: { now?: () => number; runtimeId?: string; deployment?: MongoConnectionSource['deployment'] } = {}) => {
  const now = options.now || Date.now;
  const runtimeId = options.runtimeId || randomUUID();
  const deployment = options.deployment || connectionDeployment();
  const sources = new Map<string, Tracked>();
  const clients = new WeakMap<Emitter, Tracked>();
  const track = (client: Emitter, purpose: 'home' | 'custom', appName: string) => {
    const id = CONNECTION_SNAPSHOT_PREFIX + randomUUID();
    const source: MongoConnectionSource = {
      id, runtimeId, startedAt: new Date(now()).toISOString(), observedAt: new Date(now()).toISOString(), freshness: 'current', purpose, status: 'connecting', appName,
      reason: purpose === 'home' ? 'Shared home client for API identity, control and default content operations.' : 'Bounded cached client for a request-selected custom data plane; private endpoint details are withheld.',
      createdBy: 'Thingtime API runtime', deployment, featureUsage: [], pools: [], totals: { open: 0, checkedOut: 0, created: 0, closed: 0 }
    };
    const tracked: Tracked = { source, pools: new Map() };
    sources.set(id, tracked);
    clients.set(client, tracked);
    const mode = client.options?.loadBalanced === true ? 'load-balanced' : ['poll', 'stream', 'auto'].includes(String(client.options?.serverMonitoringMode)) ? client.options!.serverMonitoringMode as 'poll' | 'stream' | 'auto' : 'unknown';
    let servers = 0;
    const updateMonitoring = () => { source.monitoring = { mode, servers, socketsUpperBound: source.status === 'ready' && mode !== 'unknown' && servers > 0 ? servers * (mode === 'load-balanced' ? 0 : mode === 'poll' ? 1 : 2) : null, basis: 'topology-model' }; };
    client.on('topologyDescriptionChanged', event => {
      servers = event?.newDescription?.servers instanceof Map ? event.newDescription.servers.size : 0;
      updateMonitoring();
    });
    updateMonitoring();
    const pool = (event: any) => {
      // Driver addresses are opaque keys internally. Custom hosts are never published.
      const key = typeof event?.address === 'string' ? event.address : 'unknown';
      let entry = tracked.pools.get(key);
      if (!entry) {
        entry = { view: { id: `${id}:pool-${tracked.pools.size + 1}`, address: purpose === 'home' ? safeConnectionAddress(key) : null,
          status: 'paused', open: 0, pending: 0, checkedOut: 0, created: 0, closed: 0, cleared: 0,
          maxPoolSize: optionCount(event?.options?.maxPoolSize), minPoolSize: optionCount(event?.options?.minPoolSize),
          maxIdleTimeMS: optionCount(event?.options?.maxIdleTimeMS), maxConnecting: optionCount(event?.options?.maxConnecting), waitQueueTimeoutMS: optionCount(event?.options?.waitQueueTimeoutMS) }, open: new Set(), pending: new Set(), checkedOut: new Set() };
        tracked.pools.set(key, entry);
      }
      return entry;
    };
    const on = (eventName: string, action: (entry: ReturnType<typeof pool>, event: any) => void) => client.on(eventName, event => { action(pool(event), event); source.observedAt = new Date(now()).toISOString(); });
    on('connectionPoolCreated', () => {});
    on('connectionPoolReady', entry => { entry.view.status = 'ready'; source.status = 'ready'; updateMonitoring(); });
    on('connectionPoolCleared', entry => { entry.view.cleared++; entry.view.status = 'paused'; });
    on('connectionPoolClosed', entry => {
      entry.view.status = 'closed'; entry.view.closed += entry.open.size + entry.pending.size; entry.open.clear(); entry.pending.clear(); entry.checkedOut.clear();
    });
    client.on('topologyClosed', () => { if (source.status !== 'failed') source.status = 'closed'; updateMonitoring(); });
    on('connectionCreated', (entry, event) => { const key = String(event.connectionId); if (!entry.open.has(key) && !entry.pending.has(key)) { entry.pending.add(key); entry.view.created++; } });
    on('connectionReady', (entry, event) => { const key = String(event.connectionId); if (entry.pending.delete(key)) entry.open.add(key); });
    on('connectionClosed', (entry, event) => { const key = String(event.connectionId); const existed = entry.open.delete(key); const wasPending = entry.pending.delete(key); if (existed || wasPending) entry.view.closed++; entry.checkedOut.delete(key); });
    on('connectionCheckedOut', (entry, event) => { const key = String(event.connectionId); if (entry.open.has(key)) entry.checkedOut.add(key); });
    on('connectionCheckedIn', (entry, event) => { entry.checkedOut.delete(String(event.connectionId)); });
    return { ready: () => { source.status = 'ready'; updateMonitoring(); }, failed: () => { source.status = 'failed'; updateMonitoring(); } };
  };
  const recordAccess = (client: Emitter) => {
    const context = featureContext.getStore(), tracked = clients.get(client);
    if (!context || !tracked || context.touched.has(tracked.source.id)) return;
    context.touched.add(tracked.source.id);
    const rows = tracked.source.featureUsage!;
    let row = rows.find(row => row.feature === context.feature);
    if (!row) { row = { feature: context.feature, accesses: 0, lastUsedAt: '' }; rows.push(row); }
    row.accesses = Math.min(Number.MAX_SAFE_INTEGER, row.accesses + 1);
    row.lastUsedAt = new Date(now()).toISOString();
  };
  const snapshot = (): MongoConnectionSource[] => [...sources.values()].map(({ source, pools }) => {
    const rows = [...pools.values()].map(entry => ({ ...entry.view, open: entry.open.size, pending: entry.pending.size, checkedOut: entry.checkedOut.size }));
    return { ...source, featureUsage: source.featureUsage?.map(row => ({ ...row })), monitoring: source.monitoring ? { ...source.monitoring } : undefined, deployment: { ...source.deployment }, observedAt: new Date(now()).toISOString(), pools: rows,
      totals: rows.reduce((sum, row) => ({ open: sum.open + row.open, checkedOut: sum.checkedOut + row.checkedOut, created: sum.created + row.created, closed: sum.closed + row.closed }), { open: 0, checkedOut: 0, created: 0, closed: 0 }) };
  });
  const pruneClosed = (ids: string[]) => { for (const id of ids) { const entry = sources.get(id); if (entry && (entry.source.status === 'closed' || entry.source.status === 'failed')) sources.delete(id); } };
  return { runtimeId, track, snapshot, pruneClosed, recordAccess };
};
export const mongoConnectionTracker = createConnectionTracker();
