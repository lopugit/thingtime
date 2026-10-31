// A bounded author-curated set of references, never copied private Thing data.
export const MAX_POST_THINGS = 20;
export type PostThingReference = { id: string; mode: 'data' | 'interactive' };
export type PostThingCollection = { kind: 'thing-collection'; items: PostThingReference[]; data?: Record<string, unknown> };
export function postThingReferences(value: unknown): PostThingReference[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'thing-collection' || !Array.isArray(raw.items)) return [];
  const seen = new Set<string>();
  return raw.items.slice(0, MAX_POST_THINGS).flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item.id) || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, mode: item.mode === 'data' ? 'data' : 'interactive' }];
  });
}
export function postThingDraft(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== 'thing-collection') return raw;
  return raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data as Record<string, unknown> : null;
}
export function composePostThing(data: Record<string, unknown> | null, items: PostThingReference[]): Record<string, unknown> | null {
  return items.length ? { kind: 'thing-collection', items: items.slice(0, MAX_POST_THINGS), ...(data && Object.keys(data).length ? { data } : {}) } : data;
}
