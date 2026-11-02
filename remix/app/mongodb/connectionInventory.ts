/** Administrator projection. Counts cover application CMAP sockets, never driver monitoring sockets. */
export type MongoConnectionPool = {
  id: string; address: string | null; status: 'ready' | 'paused' | 'closed';
  open: number; pending: number; checkedOut: number; created: number; closed: number; cleared: number; maxPoolSize: number | null;
};
export type MongoConnectionSource = {
  id: string; runtimeId: string; startedAt: string; observedAt: string;
  freshness: 'current' | 'recent' | 'stale'; purpose: 'home' | 'custom';
  status: 'connecting' | 'ready' | 'closed' | 'failed'; appName: string;
  reason: string; createdBy: 'Thingtime API runtime';
  deployment: { environment: string; branch: string | null; commit: string | null; url: string | null; region: string | null; deploymentId?: string | null };
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
