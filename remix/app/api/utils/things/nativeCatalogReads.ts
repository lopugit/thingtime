import { nativeComponentCandidates } from '../webpages/componentCandidates';
import type { ThingsReads, ThingsSelection, StoredThing } from './persistence';
import { canViewInherited, fail, parseChronoCursor, toPublicThings, type Fail, type PublicThing, type ThingDoc, type Viewer } from './things';

type Kind = 'component' | 'schema';
type Decoration = { reactionCounts: Record<string, number>; viewerReactions: string[]; saved: boolean; usageCount: number };
type Design = { id: string; library: string };
type Ranked = { row: StoredThing; key: string; createdAt: Date; reactionCount: number; designs?: Design[] };
export type NativeCatalogPage = { things: Array<PublicThing & Decoration & { designs?: Design[] }>; nextCursor: string | null; total: number | null; totalCapped: false };
export type NativeCatalogOptions = {
 mode: 'visible' | 'mine' | 'library'; sort: 'newest' | 'oldest' | 'popular'; cursor?: unknown; limit: number;
 library?: string | null; category?: string | null; family?: string | null; groupFamilies?: boolean;
};
const binary = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const chrono = (a: StoredThing, b: StoredThing, oldest = false) => (oldest ? 1 : -1) * (+a.createdAt - +b.createdAt) || binary(a.shareId, b.shareId);
const designLibraries = ['thingtime', 'antd', 'bootstrap', 'mui', 'shadcn', 'untitled', 'daisyui', 'reactflow', 'custom'];
const designRank = (value: unknown) => { const index = designLibraries.indexOf(typeof value === 'string' ? value : ''); return index < 0 ? designLibraries.length : index; };
const designOrder = (a: StoredThing, b: StoredThing) => designRank(a.crystal?.library) - designRank(b.crystal?.library) || binary(a.shareId, b.shareId);

/** Process internal batches without retaining the corpus. The underlying native
 * provider still scans; this adapter makes no indexed-query performance claim. */
async function* batches(reads: ThingsReads, selection: Omit<ThingsSelection, 'limit' | 'cursor'>): AsyncGenerator<StoredThing[]> {
 let cursor: string | null = null;
 do { const page = await reads.readWindow({ ...selection, limit: 128, cursor }); yield page.documents; cursor = page.nextCursor; } while (cursor !== null);
}
async function visible(row: StoredThing, viewer: Viewer) { return canViewInherited(row as ThingDoc, viewer); }
const filter = (row: StoredThing, options: NativeCatalogOptions) =>
 (!options.library || row.crystal?.library === options.library) && (!options.category || row.crystal?.category === options.category);

async function decorate(reads: ThingsReads, viewer: Viewer, kind: Kind, docs: StoredThing[]): Promise<NativeCatalogPage['things']> {
 if (!docs.length) return [];
 const ids = new Set(docs.map(row => row.shareId)), keys = new Set(docs.map(row => kind === 'component' ? row.crystal?.componentKey : row.crystal?.name).filter(value => typeof value === 'string'));
 const reactions = new Map<string, { counts: Record<string, number>; viewer: Set<string> }>(), saves = new Set<string>(), usage = new Map<string, number>();
 for await (const page of batches(reads, { kinds: ['reaction'] })) for (const row of page) {
  if (!ids.has(row.targetId) || typeof row.crystal?.emoji !== 'string') continue;
  const entry = reactions.get(row.targetId) ?? { counts: Object.create(null), viewer: new Set<string>() };
  entry.counts[row.crystal.emoji] = (entry.counts[row.crystal.emoji] ?? 0) + 1;
  if (row.ownerId === viewer?.id) entry.viewer.add(row.crystal.emoji);
  reactions.set(row.targetId, entry);
 }
 if (viewer?.id) for await (const page of batches(reads, { kinds: ['save'], ownerId: viewer.id })) for (const row of page) if (ids.has(row.targetId)) saves.add(row.targetId);
 for await (const page of batches(reads, { kinds: [kind === 'component' ? 'component' : 'data'] })) for (const row of page) {
  let key: unknown;
  if (kind === 'component') { key = row.crystal?.componentKey; if (typeof key !== 'string' || !keys.has(key)) continue; }
  else if (Object.prototype.hasOwnProperty.call(row.crystal ?? {}, 'schemaId')) { key = row.crystal.schemaId; if (!ids.has(key)) continue; }
  else { key = row.crystal?.schema; if (typeof key !== 'string' || !keys.has(key)) continue; }
  if (typeof key === 'string' && await visible(row, viewer)) usage.set(key, (usage.get(key) ?? 0) + 1);
 }
 const projected = await toPublicThings(docs as ThingDoc[], viewer);
 return projected.map(thing => {
  const entry = reactions.get(thing.id), key = kind === 'component' ? thing.crystal?.componentKey : thing.crystal?.name;
  return { ...thing, reactionCounts: entry?.counts ?? {}, viewerReactions: [...entry?.viewer ?? []], saved: saves.has(thing.id),
   usageCount: kind === 'component' ? Math.max(0, (typeof key === 'string' ? usage.get(key) ?? 0 : 0) - 1) : (usage.get(thing.id) ?? 0) + (typeof key === 'string' ? usage.get(key) ?? 0 : 0) };
 });
}

async function reactionTotals(reads: ThingsReads, ids: Set<string>): Promise<Map<string, number>> {
 const totals = new Map<string, number>();
 if (ids.size) for await (const page of batches(reads, { kinds: ['reaction'] })) for (const row of page) if (ids.has(row.targetId)) totals.set(row.targetId, (totals.get(row.targetId) ?? 0) + 1);
 return totals;
}
async function* candidates(reads: ThingsReads, viewer: Viewer, kind: Kind, options: NativeCatalogOptions): AsyncGenerator<Ranked> {
 for await (const page of batches(reads, { kinds: [kind], ...(options.mode === 'mine' ? { ownerId: viewer!.id! } : {}) })) {
  const allowed: StoredThing[] = [];
  for (const row of page) if (filter(row, options) && await visible(row, viewer)) allowed.push(row);
  const totals = options.sort === 'popular' ? await reactionTotals(reads, new Set(allowed.map(row => row.shareId))) : new Map<string, number>();
  for (const row of allowed) yield { row, key: row.shareId, createdAt: row.createdAt, reactionCount: totals.get(row.shareId) ?? 0 };
 }
}
const familyOf = (row: StoredThing) => typeof row.crystal?.familyKey === 'string' ? row.crystal.familyKey : row.shareId;
async function* families(reads: ThingsReads, viewer: Viewer, options: NativeCatalogOptions): AsyncGenerator<Ranked> {
 // Without keyed families, each visible identity is already its complete group.
 // Check before using that shortcut: a familyKey may equal another row's shareId.
 let keyed = false;
 outer: for await (const page of batches(reads, { kinds: ['component'] })) for (const row of page) {
  if (typeof row.crystal?.familyKey === 'string' && filter(row, options) && await visible(row, viewer)) { keyed = true; break outer; }
 }
 if (!keyed) {
  yield* candidates(reads, viewer, 'component', options);
  return;
 }
 // Aggregate at most128 candidate keys per pass, not one scan per component.
 // The newest authorized member (binary identity tie-break) anchors each group
 // to one source window. This deduplicates without a catalogue-sized key map.
 // With keyed groups the remaining cost is B²+B read windows for B batches;
 // a native grouping index/primitive is still needed for performance parity.
 for await (const page of batches(reads, { kinds: ['component'] })) {
  const groups = new Map<string, { anchor: StoredThing; representative: StoredThing }>();
  for (const row of page) if (filter(row, options) && await visible(row, viewer)) groups.set(familyOf(row), { anchor: row, representative: row });
  if (!groups.size) continue;
  for await (const siblings of batches(reads, { kinds: ['component'] })) for (const row of siblings) {
   const group = groups.get(familyOf(row));
   if (!group || !filter(row, options) || !await visible(row, viewer)) continue;
   if (chrono(row, group.anchor) < 0) group.anchor = row;
   if (designOrder(row, group.representative) < 0) group.representative = row;
  }
  const identities = new Set(page.map(row => row.shareId));
  for (const [key, group] of groups) if (identities.has(group.anchor.shareId)) yield { row: group.representative, key, createdAt: group.anchor.createdAt, reactionCount: 0 };
 }
}
const rankedOrder = (popular: boolean) => (a: Ranked, b: Ranked) => (popular ? b.reactionCount - a.reactionCount : 0) || +b.createdAt - +a.createdAt || binary(a.key, b.key);
async function top(source: () => AsyncGenerator<Ranked>, compare: (a: Ranked, b: Ranked) => number, count: number, after: Ranked | null) {
 const rows: Ranked[] = []; let total = 0;
 for await (const row of source()) {
  total++;
  if (after && compare(row, after) <= 0) continue;
  rows.push(row); rows.sort(compare); if (rows.length > count) rows.pop();
 }
 return { rows, total };
}

export async function browseNativeCatalog(reads: ThingsReads, viewer: Viewer, kind: Kind, options: NativeCatalogOptions): Promise<Fail | NativeCatalogPage> {
 if (options.mode !== 'visible' && !viewer?.id) return fail(401, `Sign in to see your ${kind}s`);
 if (options.family) {
  let docs: StoredThing[] = [];
  for await (const page of batches(reads, { kinds: ['component'] })) for (const row of page) if ((row.crystal?.familyKey === options.family || row.crystal?.componentKey === options.family) && await visible(row, viewer)) docs.push(row);
  const expand = docs.find(row => typeof row.crystal?.familyKey === 'string' && row.crystal.familyKey !== options.family)?.crystal.familyKey;
  if (expand) {
   docs = [];
   for await (const page of batches(reads, { kinds: ['component'] })) for (const row of page) if (row.crystal?.familyKey === expand && await visible(row, viewer)) docs.push(row);
  }
  docs.sort(designOrder);
  return { things: await decorate(reads, viewer, kind, docs), nextCursor: null, total: docs.length, totalCapped: false };
 }
 if (options.sort === 'popular' || options.groupFamilies) {
  const cursor = options.cursor == null || options.cursor === '' ? '0' : String(options.cursor);
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) return fail(400, 'Invalid catalog ranking cursor');
  const offset = Number(cursor), compare = rankedOrder(options.sort === 'popular');
  const source = () => options.groupFamilies ? families(reads, viewer, options) : candidates(reads, viewer, kind, options);
  // Numeric offset compatibility without retaining offset+limit full records.
  // Seek through bounded windows; no hidden 500-result or family-size ceiling.
  let remaining = offset, after: Ranked | null = null;
  while (remaining) {
   const count = Math.min(128, remaining), skip = await top(source, compare, count, after);
   if (skip.rows.length < count) return { things: [], nextCursor: null, total: null, totalCapped: false };
   after = skip.rows[skip.rows.length - 1]; remaining -= count;
  }
  const page = await top(source, compare, options.limit + 1, after), selected = page.rows.slice(0, options.limit);
  if (options.groupFamilies) {
   const rosters = new Map(selected.map(value => [value.key, [] as Design[]]));
   for await (const batch of batches(reads, { kinds: ['component'] })) for (const row of batch) {
    const roster = rosters.get(familyOf(row));
    if (roster && filter(row, options) && await visible(row, viewer)) roster.push({ id: row.shareId, library: typeof row.crystal?.library === 'string' ? row.crystal.library : 'custom' });
   }
   for (const value of selected) value.designs = rosters.get(value.key)!.sort((a, b) => designRank(a.library) - designRank(b.library) || binary(a.id, b.id));
  }
  const things = await decorate(reads, viewer, kind, selected.map(value => value.row));
  for (let index = 0; index < things.length; index++) if ((selected[index].designs?.length ?? 0) > 1) things[index].designs = selected[index].designs;
  return { things, nextCursor: page.rows.length > options.limit ? String(offset + options.limit) : null, total: options.cursor ? null : page.total, totalCapped: false };
 }
 const parsed = parseChronoCursor(typeof options.cursor === 'string' ? options.cursor : undefined);
 if (options.cursor != null && options.cursor !== '' && !parsed) return fail(400, 'Invalid catalog chronological cursor');
 const oldest = options.mode !== 'library' && options.sort === 'oldest', compare = (a: StoredThing, b: StoredThing) => chrono(a, b, oldest);
 const rows: StoredThing[] = []; let total = 0;
 for await (const page of batches(reads, { kinds: [options.mode === 'library' ? 'save' : kind], ...(options.mode !== 'visible' ? { ownerId: viewer!.id! } : {}) })) for (const row of page) {
  if (options.mode !== 'library' && (!filter(row, options) || !await visible(row, viewer))) continue;
  total++;
  if (parsed && compare(row, { createdAt: parsed.createdAt, shareId: parsed.id }) <= 0) continue;
  rows.push(row); rows.sort(compare); if (rows.length > options.limit + 1) rows.pop();
 }
 const page = rows.slice(0, options.limit), last = page[page.length - 1];
 let docs = page;
 if (options.mode === 'library') {
  const ids = page.map(row => row.targetId).filter(value => typeof value === 'string');
  const found = kind === 'component' ? await nativeComponentCandidates(reads, ids, [], null) : await reads.readBatch(ids);
  const byId = new Map(found.filter(row => row.thingtime?.includes(kind)).map(row => [row.shareId, row])); docs = [];
  for (const id of ids) { const row = byId.get(id); if (row && await visible(row, viewer)) docs.push(row); }
 }
 return { things: await decorate(reads, viewer, kind, docs), nextCursor: rows.length > options.limit && last ? `${+last.createdAt}_${last.shareId}` : null,
  total: options.mode === 'library' || options.cursor ? null : total, totalCapped: false };
}
