import { searchLocalThings } from './structuredSearch';
import { localSearchText } from './librarySearch';
import { localInteractionState } from './interactions';
import { localTargetIndex } from './posts';
import { WorkspaceError } from './storage';
import { designRank, type BrowseComponentEntry } from '../components/ComponentsLibrary/componentBrowseTypes';
import type { LocalThing } from './things';

/** Browse only the supplied leased snapshot and trusted in-bundle definitions.
 * Filtering and family grouping happen before pagination. Catalogue records are
 * read-only projections; they never become owned records by being displayed. */
export async function browseLocalDefinitions(rows: LocalThing[], kind: 'schema' | 'component', args: Record<string, unknown>, scope: string, project: (row: LocalThing) => any, bundled: BrowseComponentEntry[] = []) {
 const index = localTargetIndex(rows), library = !!args.library;
 const saved = new Set(rows.filter(row => row.thingtime.includes('save')).map(row => row.targetId));
 const platform = new Map((args.mine || library ? [] : bundled).map(row => [row.id, row]));
 const localIds = new Set(rows.map(row => row.id));
 const all = [...rows, ...[...platform.values()].filter(row => !localIds.has(row.id)).map(row => ({ ...row, revision: 0 }))];
 let candidates = library ? all.filter(row => saved.has(row.id)) : all;
 const designs = new Map<string, { id: string; library: string }[]>();
 let catalogScope = '';
 if (kind === 'component') {
  for (const key of ['family', 'lib', 'category']) if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key] || (args[key] as string).length > 200)) throw new WorkspaceError('INVALID_CATALOG_FILTER', `Invalid component ${key} filter.`);
  if (args.group !== undefined && args.group !== 'family') throw new WorkspaceError('INVALID_CATALOG_FILTER', 'Unknown component grouping.');
  candidates = candidates.filter(row => row.thingtime.includes('component'));
  if (args.family) {
   const key = String(args.family), slug = key.startsWith('component-') ? key.slice(10) : key;
   const matches = candidates.filter(row => row.id === key || row.crystal.familyKey === slug || row.crystal.componentKey === slug);
   const families = new Set(matches.map(row => row.crystal.familyKey).filter(value => typeof value === 'string' && value));
   const matchedIds = new Set(matches.map(row => row.id));
   candidates = candidates.filter(row => matchedIds.has(row.id) || families.has(row.crystal.familyKey));
  }
  candidates = candidates.filter(row => (!args.lib || row.crystal.library === args.lib) && (!args.category || row.crystal.category === args.category));
  if (args.group === 'family') {
   const q = typeof args.q === 'string' ? args.q.trim().normalize('NFKC').toLowerCase() : '';
   const groups = new Map<string, LocalThing[]>();
   for (const row of candidates) {
    if (q && !localSearchText(row).includes(q)) continue;
    const key = typeof row.crystal.familyKey === 'string' && row.crystal.familyKey ? row.crystal.familyKey : row.id;
    const group = groups.get(key) || []; group.push(row); groups.set(key, group);
   }
   candidates = [...groups.values()].map(group => {
    group.sort((a, b) => designRank(String(a.crystal.library)) - designRank(String(b.crystal.library)) || Number(platform.has(a.id)) - Number(platform.has(b.id)) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    designs.set(group[0].id, group.map(row => ({ id: row.id, library: String(row.crystal.library || 'custom') })));
    return group[0];
   });
  }
  catalogScope = JSON.stringify([args.family, args.lib, args.category, args.group, !!args.mine]);
 }
 const page = await searchLocalThings(candidates, { q: args.q, sort: args.sort, cursor: args.cursor, limit: args.limit, thingtime: kind }, `${scope}:catalog:${kind}:${library}:${catalogScope}`);
 const usage = new Map<string, number>();
 for (const row of rows) {
  const key = kind === 'schema' && row.thingtime.includes('data') ? row.crystal.schemaId : kind === 'component' && row.thingtime.includes('component') ? row.crystal.componentKey : null;
  if (typeof key === 'string') usage.set(key, (usage.get(key) || 0) + 1);
 }
 const entries = page.things.map(row => {
  const state = localInteractionState(row, index.get(row.id) || []);
  return { ...(platform.get(row.id) || project(row)), reactionCounts: state.reactionCounts, viewerReactions: state.viewerReactions, saved: state.viewerSaved,
   usageCount: kind === 'schema' ? usage.get(row.id) || 0 : Math.max(0, (usage.get(String(row.crystal.componentKey)) || 0) - Number(localIds.has(row.id))),
   ...(designs.has(row.id) ? { designs: designs.get(row.id) } : {}) };
 });
 const { things: _things, ...metadata } = page;
 return { ...metadata, schemas: kind === 'schema' ? entries : undefined, components: kind === 'component' ? entries : undefined };
}
