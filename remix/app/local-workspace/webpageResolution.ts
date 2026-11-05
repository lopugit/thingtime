import { selectComponent } from '../api/utils/webpages/componentResolutionCore';
import { webpageComponentRefs } from '../timeline/componentBindings';
import type { LocalThing } from './things';
export type LocalWebpageTarget = { kind: 'id'; id: string; key?: string } | { kind: 'path'; path: string } | { kind: 'global' };
export function resolveWorkspacePage<T extends LocalThing>(all: T[], target: LocalWebpageTarget, ownerId: string) {
 const ordered = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
 const pages = ordered.filter(row => row.thingtime.includes('webpage'));
 const page = target.kind === 'id' ? pages.find(row => row.id === target.id) || pages.find(row => row.crystal.pageKey === target.id) : pages.find(row => target.kind === 'path' ? row.crystal.siteRoute === target.path : row.crystal.pageKey === 'site-global');
 const candidates = ordered.filter(row => row.thingtime.includes('component')).map(row => ({ row, shareId: row.id, ownerId, crystal: row.crystal }));
 const refs: Record<string, string | null> = Object.create(null), selected = new Map<string, T>();
 for (const ref of webpageComponentRefs(page?.crystal.blocks)) {
  const found = selectComponent(ref, candidates, ownerId)?.row;
  refs[ref] = found?.id || null; if (found) selected.set(found.id, found);
 }
 return { page: page || null, components: [...selected.values()], refs };
}
