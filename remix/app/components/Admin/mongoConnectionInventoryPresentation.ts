import type { MongoConnectionInventory, MongoConnectionSource } from '~/mongodb/connectionInventory';
export const safeDeploymentUrl = (value: string | null): string => {
 try { const url = new URL(value || ''); return (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.href : ''; } catch { return ''; }
};
const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString(); };
export function presentMongoSources(sources: MongoConnectionSource[], query: string, freshness: string) {
 const needle = query.trim().toLowerCase();
 return sources.filter(source => (freshness === 'all' || source.freshness === freshness) &&
  [source.appName, source.runtimeId, source.reason, source.purpose, source.deployment.deploymentId, source.deployment.region, source.deployment.branch, source.deployment.url, source.deployment.environment, ...(source.featureUsage || []).map(usage => usage.feature), ...source.pools.map(pool => pool.address)].some(value => String(value || '').toLowerCase().includes(needle))).map(source => ({
  ...source, title: source.appName || source.runtimeId, state: `${source.status} · ${source.freshness} snapshot`,
  counts: `${Number.isFinite(source.totals.open) ? source.totals.open : 'unavailable'} observed pool sockets · ${Number.isFinite(source.totals.checkedOut) ? source.totals.checkedOut : 'unavailable'} checked out`,
  observed: `Observed ${time(source.observedAt)}`, url: safeDeploymentUrl(source.deployment.url), hasUrl: Boolean(safeDeploymentUrl(source.deployment.url)),
  environment: `${source.deployment.environment} / ${source.deployment.region || 'Region unavailable'}`,
  deploymentId: source.deployment.deploymentId || 'Unavailable', branch: source.deployment.branch || 'Unavailable', commit: source.deployment.commit || 'Unavailable', startedAt: time(source.startedAt),
  poolRows: source.pools.map(pool => ({ address: pool.address || 'Host unavailable', state: `${pool.status} · maximum pool size ${pool.maxPoolSize === 0 ? 'unlimited' : pool.maxPoolSize ?? 'unknown'}`, counts: `${pool.open} observed open · ${pool.checkedOut} checked out · ${pool.pending ?? 0} pending handshake`, lifecycle: `${pool.created} created · ${pool.closed} closed · ${pool.cleared} pool clears` }))
 }));
}

/** A loaded page is a snapshot, not a replacement for previously loaded sources. */
export function mergeMongoInventory(previous: MongoConnectionInventory | null, next: MongoConnectionInventory, append: boolean): MongoConnectionInventory {
 const sources = append && previous ? [...new Map([...previous.sources, ...next.sources].map(source => [source.id, source])).values()] : next.sources;
 return { ...next, sources, totals: { ...next.totals,
  observedOpen: sources.reduce((sum, source) => sum + source.totals.open, 0),
  observedCheckedOut: sources.reduce((sum, source) => sum + source.totals.checkedOut, 0),
  freshSources: sources.filter(source => source.freshness !== 'stale').length,
  staleSources: sources.filter(source => source.freshness === 'stale').length
 } };
}

const count = (value: number | null | undefined) => Number.isFinite(value) ? Math.max(0, value!) : 0;
/** Immutable deployment IDs are the only grouping authority. Missing IDs stay separate. */
export function presentMongoDeployments(sources: MongoConnectionSource[], query = '', freshness = 'all') {
 const matches = new Set(presentMongoSources(sources, query, freshness).map(source => source.id));
 const groups = new Map<string, MongoConnectionSource[]>();
 for (const source of sources) {
  const key = source.deployment.deploymentId ? `deployment:${source.deployment.deploymentId}` : `unidentified:${source.id}`;
  groups.set(key, [...(groups.get(key) || []), source]);
 }
 return [...groups.entries()].filter(([, group]) => group.some(source => matches.has(source.id))).map(([id, group]) => {
  const first = group[0];
  const active = group.filter(source => source.freshness !== 'stale' && source.status === 'ready');
  const open = active.reduce((sum, source) => sum + count(source.totals.open), 0);
  const inUse = active.reduce((sum, source) => sum + Math.min(count(source.totals.open), count(source.totals.checkedOut)), 0);
  const monitoring = active.map(source => source.monitoring?.socketsUpperBound);
  const estimateKnown = active.length > 0 && monitoring.every(value => value != null && Number.isFinite(value));
  const overhead = monitoring.reduce<number>((sum, value) => sum + count(value), 0);
  const pending = active.reduce((sum, source) => sum + source.pools.reduce((total, pool) => total + count(pool.pending), 0), 0);
  const runtimeCount = new Set(active.map(source => source.runtimeId)).size;
  const historical = group.length - active.length;
  const featureLabels: Record<string, string> = { auth: 'Accounts and sign-in', feed: 'Feed and posts', things: 'Things and data', builder: 'Builder and saved pages', lopu: 'Lopu assistant', admin: 'Administration', devices: 'Devices', files: 'Files and attachments', notifications: 'Notifications', other: 'Other API features' };
  const features = new Map<string, number>();
  const featureTimes = new Map<string, string>();
  const missingUsage = active.filter(source => source.featureUsage === undefined).length;
  for (const source of active) for (const usage of source.featureUsage || []) {
   features.set(usage.feature, (features.get(usage.feature) || 0) + count(usage.accesses));
   if (!featureTimes.has(usage.feature) || new Date(usage.lastUsedAt).getTime() > new Date(featureTimes.get(usage.feature)!).getTime()) featureTimes.set(usage.feature, usage.lastUsedAt);
  }
  return { id, title: first.deployment.branch || first.deployment.environment || 'Unidentified deployment',
   deploymentId: first.deployment.deploymentId || 'Deployment ID unavailable — this source is kept separate',
   environment: `${first.deployment.environment} · ${[...new Set(group.map(source => source.deployment.region || 'region unavailable'))].join(', ')}`,
   url: safeDeploymentUrl(first.deployment.url), hasUrl: Boolean(safeDeploymentUrl(first.deployment.url)),
   open: active.length ? String(open) : 'Unavailable', inUse: active.length ? String(inUse) : 'Unavailable', idle: active.length ? String(Math.max(0, open - inUse)) : 'Unavailable',
   estimate: estimateKnown ? `${open}–${open + overhead + pending}` : 'Unavailable',
   estimateNote: estimateKnown ? `${open} observed app sockets + 0–${overhead} modeled monitoring sockets + 0–${pending} pending handshakes across ${active.length} warm client${active.length === 1 ? '' : 's'}. Across observed members; not a per-node Atlas value.` : 'A recent ready client and its monitoring model are required.',
   runtimeSummary: `${runtimeCount} recent observed warm runtime${runtimeCount === 1 ? '' : 's'} · ${active.length} ready client${active.length === 1 ? '' : 's'}`,
   observation: `Latest snapshot ${time(group.map(source => source.observedAt).sort().slice(-1)[0] || '')}${historical ? ` · ${historical} historical / non-ready source${historical === 1 ? '' : 's'} excluded from counts` : ''}`,
   featureSummary: `${features.size ? [...features.keys()].map(feature => featureLabels[feature] || 'Other API features').join(' · ') : missingUsage || !active.length ? 'Feature usage unavailable' : 'No feature usage recorded for these clients'}${missingUsage && features.size ? ` · usage unavailable for ${missingUsage} client${missingUsage === 1 ? '' : 's'}` : ''}`,
   featureRows: [...features].map(([feature, accesses]) => ({ feature: featureLabels[feature] || 'Other API features', accesses: `${accesses} recorded shared-client access${accesses === 1 ? '' : 'es'} · last used ${time(featureTimes.get(feature) || '')}` })),
   rows: presentMongoSources(group, '', 'all').map(source => ({ ...source,
    eligibility: source.freshness === 'stale' || source.status !== 'ready' ? 'Historical / non-ready — excluded from headline counts' : 'Included in recent observed counts',
    monitoringLabel: source.monitoring ? `${source.monitoring.mode} monitoring · ${source.monitoring.servers} known servers · up to ${source.monitoring.socketsUpperBound ?? 'unknown'} sockets (model)` : 'Monitoring model unavailable',
    poolRows: source.poolRows.map((pool, index) => ({ ...pool, settings: `Minimum pool ${source.pools[index]?.minPoolSize ?? 'unknown'} · ${source.pools[index]?.maxIdleTimeMS === 0 ? 'No idle expiry' : `Idle timeout ${source.pools[index]?.maxIdleTimeMS ?? 'unknown'} ms`}` }))
   }))
  };
 });
}

/** Explain deployment headlines without changing the legacy raw-snapshot contract. */
export function presentMongoCoverageNotes(notes: readonly string[]) {
 const legacySnapshotScope = 'Counts below sum the sources on this page at their observation times, including stale snapshots; they are not a live database or deployment total.';
 const deploymentScope = 'Deployment headline counts include only current or recent ready client observations from loaded snapshots. Stale, closed and failed sources are historical and excluded from those counts. Separate raw loaded-snapshot totals retain historical observations. Neither is a live database total.';
 return notes.map(text => ({ text: text === legacySnapshotScope ? deploymentScope : text }));
}
