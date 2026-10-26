export type CustomDrawerItem = { id: string; emoji: string; title: string; tooltip: string; url: string; thingId?: string; thingTitle?: string };

/** Validate again at the navigation boundary, including persisted/imported preferences. */
export function customDrawerUrl(value: unknown): string | null {
 if (typeof value !== 'string' || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
 const url = value.trim();
 if (/\s/.test(url)) return null;
 if (!url) return null;
 try {
  const parsed = new URL(url, 'https://drawer.invalid/');
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
  // Protocol-relative destinations obscure the external origin in the editor.
  if (url.startsWith('//')) return null;
  return url;
 } catch { return null; }
}
export function normalizeCustomDrawerItems(value: unknown): CustomDrawerItem[] {
 if (!Array.isArray(value)) return [];
 const ids = new Set<string>();
 return value.flatMap(item => {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^custom-[a-zA-Z0-9-]+$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim()) return [];
  const url = customDrawerUrl(item.url);
  if (!url) return [];
  ids.add(item.id);
  return [{ id: item.id, title: item.title.trim(), emoji: typeof item.emoji === 'string' ? item.emoji : '🔗', tooltip: typeof item.tooltip === 'string' ? item.tooltip : '', url, ...(typeof item.thingId === 'string' && item.thingId ? { thingId: item.thingId, ...(typeof item.thingTitle === 'string' && item.thingTitle ? { thingTitle: item.thingTitle } : {}) } : {}) }];
 });
}

/** A Thing attachment describes its selected destination, not just a label.
 * Detach immediately when a manual field snapshot changes that destination,
 * including snapshots taken while typing another Commander query. */
export function updateCustomDrawerDraft(draft: CustomDrawerItem, fields: Pick<CustomDrawerItem, 'emoji' | 'title' | 'tooltip' | 'url'>): CustomDrawerItem {
 const next = { ...draft, ...fields };
 if (draft.thingId && next.url !== draft.url) { delete next.thingId; delete next.thingTitle; }
 return next;
}

/** Reuse the workspace's own persistence boundary, including its account fence.
 * A failed optimistic mutation may restore only the exact value it wrote. */
export async function commitCustomDrawerItems(items: CustomDrawerItem[], options: {
 read: () => unknown;
 write: (items: CustomDrawerItem[]) => void;
 flush: (signal?: AbortSignal) => Promise<void>;
 signal?: AbortSignal;
}): Promise<void> {
 options.signal?.throwIfAborted();
 const previous = normalizeCustomDrawerItems(options.read());
 const next = normalizeCustomDrawerItems(items);
 options.write(next);
 try { await options.flush(options.signal); }
 catch (error) {
  if (!options.signal?.aborted && JSON.stringify(normalizeCustomDrawerItems(options.read())) === JSON.stringify(next)) {
   options.write(previous);
   await options.flush(options.signal).catch(() => {});
  }
  throw error;
 }
}
