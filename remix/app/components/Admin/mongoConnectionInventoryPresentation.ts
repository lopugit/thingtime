import type { MongoConnectionInventory, MongoConnectionSource } from '~/mongodb/connectionInventory';
export const safeDeploymentUrl = (value: string | null): string => {
 try { const url = new URL(value || ''); return (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.href : ''; } catch { return ''; }
};
const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString(); };
export function presentMongoSources(sources: MongoConnectionSource[], query: string, freshness: string) {
 const needle = query.trim().toLowerCase();
 return sources.filter(source => (freshness === 'all' || source.freshness === freshness) &&
  [source.appName, source.runtimeId, source.reason, source.purpose, source.deployment.deploymentId, source.deployment.region, source.deployment.branch, source.deployment.url, source.deployment.environment, ...source.pools.map(pool => pool.address)].some(value => String(value || '').toLowerCase().includes(needle))).map(source => ({
  ...source, title: source.appName || source.runtimeId, state: `${source.status} · ${source.freshness} snapshot`,
  counts: `${source.totals.open} observed pool sockets · ${source.totals.checkedOut} checked out`,
  observed: `Observed ${time(source.observedAt)}`, url: safeDeploymentUrl(source.deployment.url), hasUrl: Boolean(safeDeploymentUrl(source.deployment.url)),
  environment: `${source.deployment.environment} / ${source.deployment.region || 'Region unavailable'}`,
  deploymentId: source.deployment.deploymentId || 'Unavailable', branch: source.deployment.branch || 'Unavailable', commit: source.deployment.commit || 'Unavailable', startedAt: time(source.startedAt),
  poolRows: source.pools.map(pool => ({ address: pool.address || 'Host unavailable', state: `${pool.status} · maximum pool size ${pool.maxPoolSize ?? 'unknown'}`, counts: `${pool.open} observed open · ${pool.checkedOut} checked out · ${pool.pending ?? 0} pending handshake`, lifecycle: `${pool.created} created · ${pool.closed} closed · ${pool.cleared} pool clears` }))
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
