/** Administrator projection. Counts cover application CMAP sockets, never driver monitoring sockets. */
export const MONGO_CONNECTION_FEATURES = ['auth', 'feed', 'things', 'builder', 'lopu', 'admin', 'devices', 'files', 'notifications', 'other'] as const;
export type MongoConnectionFeature = typeof MONGO_CONNECTION_FEATURES[number];
export type MongoConnectionPool = {
  id: string; address: string | null; status: 'ready' | 'paused' | 'closed';
  open: number; pending: number; checkedOut: number; created: number; closed: number; cleared: number; maxPoolSize: number | null;
  minPoolSize?: number | null; maxIdleTimeMS?: number | null; maxConnecting?: number | null; waitQueueTimeoutMS?: number | null;
};
export type MongoConnectionSource = {
  id: string; runtimeId: string; startedAt: string; observedAt: string;
  freshness: 'current' | 'recent' | 'stale'; purpose: 'home' | 'custom';
  status: 'connecting' | 'ready' | 'closed' | 'failed'; appName: string;
  reason: string; createdBy: 'Thingtime API runtime';
  deployment: { environment: string; branch: string | null; commit: string | null; url: string | null; region: string | null; deploymentId?: string | null };
  monitoring?: { mode: 'poll' | 'stream' | 'auto' | 'load-balanced' | 'unknown'; servers: number; socketsUpperBound: number | null; basis: 'topology-model' };
  featureUsage?: Array<{ feature: MongoConnectionFeature; accesses: number; lastUsedAt: string }>;
  pools: MongoConnectionPool[];
  totals: { open: number; checkedOut: number; created: number; closed: number };
};
export type MongoConnectionInventory = {
  checkedAt: string; sources: MongoConnectionSource[]; nextCursor: string | null;
  totals: { observedOpen: number; observedCheckedOut: number; freshSources: number; staleSources: number;
    serverCurrent: number | null; serverAvailable: number | null; serverTotalCreated: number | null };
  server: { status: 'available' | 'unsupported' | 'unavailable'; checkedAt: string; note: string };
  coverage: { complete: false; notes: string[] };
};
