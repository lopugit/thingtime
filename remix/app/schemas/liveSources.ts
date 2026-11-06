/** Audited read-only stream adapters. Saved pages cannot choose arbitrary authenticated URLs. */
export type LiveSource = { path: string; feature: string; minimumVersion: string };
export const LIVE_SOURCES: readonly LiveSource[] = [
  { path: '/api/v1/agent-overview', feature: 'api.agent-overview', minimumVersion: '2.0.0' }
];
export function validateLiveSource(value: unknown): LiveSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const match = LIVE_SOURCES.find(entry => entry.path === source.path && entry.feature === source.feature && entry.minimumVersion === source.minimumVersion);
  return match ? { ...match } : null;
}

/** Find live bindings in a serializable crystal without following runtime objects. */
export function hasLiveSourceBinding(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new Set<object>();
  while (pending.length) {
    const entry = pending.pop();
    if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
    seen.add(entry);
    if (!Array.isArray(entry)) {
      const source = (entry as Record<string, unknown>).source;
      if (source && typeof source === 'object' &&
          ((source as Record<string, unknown>).refresh === 'live' || (source as Record<string, unknown>).stream)) return true;
    }
    for (const child of Object.values(entry)) pending.push(child);
  }
  return false;
}
