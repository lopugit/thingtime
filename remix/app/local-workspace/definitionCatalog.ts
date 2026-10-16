import { searchLocalThings } from './structuredSearch';
import { localInteractionState } from './interactions';
import { localTargetIndex } from './posts';
import type { LocalThing } from './things';

/** Browse saved definitions before paging, including real saved membership and
 * relational usage/interaction counts. Callers supply only a leased snapshot. */
export async function browseLocalDefinitions(rows: LocalThing[], kind: 'schema' | 'component', args: Record<string, unknown>, scope: string, project: (row: LocalThing) => any) {
 const index = localTargetIndex(rows);
 const library = !!args.library;
 const saved = new Set(rows.filter(row => row.thingtime.includes('save')).map(row => row.targetId));
 const page = await searchLocalThings(library ? rows.filter(row => saved.has(row.id)) : rows,
  { q: args.q, sort: args.sort, cursor: args.cursor, limit: args.limit, thingtime: kind }, `${scope}:catalog:${kind}:${library}`);
 const usage = new Map<string, number>();
 if (kind === 'schema') for (const row of rows) if (row.thingtime.includes('data') && typeof row.crystal.schemaId === 'string') usage.set(row.crystal.schemaId, (usage.get(row.crystal.schemaId) || 0) + 1);
 const entries = page.things.map(row => {
  const state = localInteractionState(row, index.get(row.id) || []);
  return { ...project(row), reactionCounts: state.reactionCounts, viewerReactions: state.viewerReactions, saved: state.viewerSaved, usageCount: usage.get(row.id) || 0 };
 });
 const { things: _things, ...metadata } = page;
 return { ...metadata, schemas: kind === 'schema' ? entries : undefined, components: kind === 'component' ? entries : undefined };
}
