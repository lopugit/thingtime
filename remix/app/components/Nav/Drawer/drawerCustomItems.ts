import { drawerMenuItems, drawerBuiltinNodes, type DrawerTopItem, filterDrawerTopItems, filterDrawerItemsByAuth } from './drawerMenu';

export type CustomDrawerItem = { parentId?: string; id: string; emoji: string; title: string; tooltip: string; url: string; thingId?: string; thingTitle?: string };

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
 const normalized: CustomDrawerItem[] = value.flatMap(item => {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^custom-[a-zA-Z0-9-]+$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim()) return [];
  const url = customDrawerUrl(item.url);
  if (!url) return [];
  ids.add(item.id);
  return [{ ...(typeof item.parentId === 'string' && item.parentId ? { parentId: item.parentId } : {}), id: item.id, title: item.title.trim(), emoji: typeof item.emoji === 'string' ? item.emoji : '🔗', tooltip: typeof item.tooltip === 'string' ? item.tooltip : '', url, ...(typeof item.thingId === 'string' && item.thingId ? { thingId: item.thingId, ...(typeof item.thingTitle === 'string' && item.thingTitle ? { thingTitle: item.thingTitle } : {}) } : {}) }];
 });
 // Imported preferences fail closed: neither orphans nor cyclic branches are promoted to roots.
 const builtin = new Set(drawerBuiltinNodes().map(({ item }) => item.id));
 const byId = new Map(normalized.map(item => [item.id, item]));
 return normalized.filter(item => {
  const seen = new Set([item.id]); let parent = item.parentId;
  while (parent) {
   if (seen.has(parent)) return false;
   if (builtin.has(parent)) return true;
   seen.add(parent); const node = byId.get(parent); if (!node) return false;
   parent = node.parentId;
  }
  return true;
 });
}

export type DrawerParentOption = { id: string; title: string; parentId?: string };
/** Parent availability inherits the exact built-in ancestor visibility policy. */
export function drawerParentOptions(items: CustomDrawerItem[], loggedIn: boolean, isAdmin: boolean, isPublished: (key: string) => boolean, menu: DrawerTopItem[] = drawerMenuItems): DrawerParentOption[] {
 const builtins: DrawerParentOption[] = [];
 const pendingBuiltins = filterDrawerTopItems(menu, loggedIn, isAdmin, isPublished).map(item => ({ item, parentId: undefined as string | undefined }));
 const visited = new Set<string>();
 while (pendingBuiltins.length) {
  const { item, parentId } = pendingBuiltins.shift()!; if (visited.has(item.id)) continue;
  visited.add(item.id); builtins.push({ id: item.id, title: item.label, ...(parentId ? { parentId } : {}) });
  pendingBuiltins.unshift(...filterDrawerItemsByAuth(item.children || [], loggedIn, isAdmin, isPublished).map(child => ({ item: { ...child, icon: child.icon || '', children: child.children || [] }, parentId: item.id })));
 }
 const custom = normalizeCustomDrawerItems(items);
 const available = new Set(builtins.map(item => item.id));
 const pending = [...custom]; const result: DrawerParentOption[] = [...builtins];
 while (pending.length) {
  const index = pending.findIndex(item => !item.parentId || available.has(item.parentId));
  if (index < 0) break;
  const [item] = pending.splice(index, 1); available.add(item.id);
  result.push({ id: item.id, title: item.title, ...(item.parentId ? { parentId: item.parentId } : {}) });
 }
 return result;
}
/** Only available direct children make a submenu reachable. Recomputed after every edit. */
export function drawerChildParentIds(items: DrawerParentOption[]): Set<string> {
 return new Set(items.flatMap(item => item.parentId ? [item.parentId] : []));
}
export function drawerAncestorPath(id: string | undefined, parents: DrawerParentOption[]): DrawerParentOption[] {
 const byId = new Map(parents.map(item => [item.id, item])); const path: DrawerParentOption[] = []; const seen = new Set<string>();
 while (id && !seen.has(id)) { seen.add(id); const item = byId.get(id); if (!item) return []; path.unshift(item); id = item.parentId; }
 return path;
}
/** Removing a container keeps its links and descendants by moving direct children up one level. */
export function removeCustomDrawerItem(items: CustomDrawerItem[], id: string): CustomDrawerItem[] {
 const removed = items.find(item => item.id === id);
 return items.filter(item => item.id !== id).map(item => {
  if (item.parentId !== id) return item;
  const next = { ...item }; delete next.parentId;
  return removed?.parentId ? { ...next, parentId: removed.parentId } : next;
 });
}
export function moveCustomDrawerSibling(items: CustomDrawerItem[], id: string, delta: number): CustomDrawerItem[] {
 const index = items.findIndex(item => item.id === id); if (index < 0) return items;
 const siblingIndexes = items.flatMap((item, i) => item.parentId === items[index].parentId ? [i] : []);
 const target = siblingIndexes[siblingIndexes.indexOf(index) + delta]; if (target === undefined) return items;
 const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next;
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
