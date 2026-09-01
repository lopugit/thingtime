import { crystalSchemas } from '~/schemas/registry';
import type { SchemaThingField, ThingtimeSchema } from '~/schemas/registry';
import { flattenSchemaFields } from '~/schemas/tools';
import type { SchemaSource } from '~/components/Search/searchTypes';

// Client-side mirrors of /api/v1/schemas/browse shapes (server source of
// truth: app/api/utils/schemas/browse.ts).

export type BrowseSchemaAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
} | null;

export type BrowseSchemaEntry = {
  id: string;
  thingtime: string[];
  author: BrowseSchemaAuthor;
  visibility: string;
  acl: string[];
  targetId: string | null;
  crystal: Record<string, any>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  reactionCounts: Record<string, number>;
  viewerReactions: string[];
  saved: boolean;
  usageCount: number;
};

export type BrowseSchemasResponse = {
  ok: boolean;
  error?: string;
  schemas: BrowseSchemaEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

// One card model over both origins: platform (registry) + community (things).
export type SchemaCardSource = {
  key: string; // stable list key ('builtin:post' | shareId)
  origin: 'builtin' | 'community';
  id: string; // registry id or thing shareId
  name: string;
  description: string;
  fields: SchemaThingField[];
  entry?: BrowseSchemaEntry; // community only
  registry?: ThingtimeSchema; // builtin only
  forkOf?: string | null;
  // optional serialised component preview (chakra/element tree) — drawn only
  // through the sanitising allowlist renderers
  render?: Record<string, unknown> | null;
};

export const entryToCardSource = (entry: BrowseSchemaEntry): SchemaCardSource | null => {
  const name = typeof entry.crystal?.name === 'string' ? entry.crystal.name : '';
  if (!name) return null;
  const fields = Array.isArray(entry.crystal?.fields) ? (entry.crystal.fields as SchemaThingField[]) : [];
  const render =
    entry.crystal?.render && typeof entry.crystal.render === 'object' && !Array.isArray(entry.crystal.render)
      ? (entry.crystal.render as Record<string, unknown>)
      : null;
  return {
    key: entry.id,
    origin: 'community',
    id: entry.id,
    name,
    description: typeof entry.crystal?.description === 'string' ? entry.crystal.description : '',
    fields,
    entry,
    forkOf: typeof entry.crystal?.forkOf === 'string' ? entry.crystal.forkOf : null,
    render
  };
};

// The crystal kinds /search's kind <Select> can scope to. Protected
// thingtimes (user/theme/…) are $nin-excluded by searchThings and share/save
// aren't searchable, so "Search things" for those builtins would dead-end.
export const SEARCHABLE_CRYSTAL_KINDS = new Set(['post', 'data', 'schema', 'comment', 'reaction', 'attachment']);

// Fieldless shapes are excluded: toSearchSource returns null for them (nothing
// to search by), so a "Search things" button / post-create deep link would
// dead-end in the "not visible" toast. Zero-field marker schemas are legal on
// the write path, so this predicate must gate on fields, not just origin.
export const searchableSchemaSource = (source: Pick<SchemaCardSource, 'origin' | 'id' | 'fields'>): boolean =>
  source.fields.length > 0 && (source.origin === 'community' || SEARCHABLE_CRYSTAL_KINDS.has(source.id));

export const registryToCardSource = (schema: ThingtimeSchema): SchemaCardSource => ({
  key: `builtin:${schema.id}`,
  origin: 'builtin',
  id: schema.id,
  name: schema.title,
  description: schema.summary,
  fields: (schema.fields || []) as unknown as SchemaThingField[],
  registry: schema
});

// ---------------------------------------------------------------------------
// Seeded-builtin mirror rule — shared by /schemas and /search.
//
// The seed-builtin-schemas admin migration mirrors every builtin crystal
// schema into things as a system-owned schema thing (shareId schema-<id>, its
// author resolving to null). Both pages already list builtins from the code
// registry, so those mirrors are dropped from the community column — without
// this they'd render twice. One set, one predicate, both pages, so the rule
// can never drift between them.
export const seededBuiltinShareIds = new Set(crystalSchemas().map((schema) => `schema-${schema.id}`));

export const isSeededBuiltinMirror = (id: string, author: unknown): boolean =>
  seededBuiltinShareIds.has(id) && !author;

// ---------------------------------------------------------------------------
// /search adapter — one card model → the flattened SchemaSource /search's
// query builder prefills from.
//
// Only fields the search grammar can actually address prefill a builder row:
// dotted crystal paths of A-Za-z0-9_-. segments. The data schema's '*' wildcard
// and object/record payload fields (already excluded by the search-mode
// flattener) would just 400 on submit.
const SEARCHABLE_FIELD_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

// Flatten a SchemaCardSource into /search's SchemaSource shape. Nested
// object/array fields flatten to the dotted crystal paths the search grammar
// addresses, carrying every field's constraint metadata (enum values, number
// min/max/unit, string maxLength) through — so builtin and community shapes
// prefill the builder identically instead of a second, drifting mapper hard-
// setting them undefined. Seeded-builtin mirrors are dropped here too (same
// rule as /schemas). Returns null for a dropped mirror or a fieldless shape —
// there's nothing to search by.
export const toSearchSource = (source: SchemaCardSource): SchemaSource | null => {
  if (isSeededBuiltinMirror(source.id, source.entry?.author)) return null;
  if (!source.fields.length) return null;
  const entry = source.entry;
  const reactions = entry
    ? Object.values(entry.reactionCounts || {}).reduce((sum, count) => sum + (count || 0), 0)
    : 0;
  return {
    key: source.origin === 'builtin' ? `builtin-${source.id}` : `thing-${source.id}`,
    name: source.name,
    description: source.description,
    origin: source.origin,
    author: source.origin === 'community' ? entry?.author?.username || null : undefined,
    shareId: source.origin === 'community' ? source.id : undefined,
    usageCount: typeof entry?.usageCount === 'number' ? entry.usageCount : undefined,
    reactions: reactions || undefined,
    fields: flattenSchemaFields(source.fields)
      .filter((flat) => SEARCHABLE_FIELD_NAME.test(flat.path))
      .map((flat) => ({
        name: flat.path,
        type: typeof flat.field.type === 'string' ? flat.field.type : 'string',
        description: typeof flat.field.description === 'string' ? flat.field.description : undefined,
        values: Array.isArray(flat.field.values)
          ? flat.field.values.filter((value) => typeof value === 'string')
          : undefined,
        min: Number.isFinite(flat.field.min) ? flat.field.min : undefined,
        max: Number.isFinite(flat.field.max) ? flat.field.max : undefined,
        unit: typeof flat.field.unit === 'string' ? flat.field.unit : undefined,
        maxLength: Number.isFinite(flat.field.maxLength) ? flat.field.maxLength : undefined
      }))
  };
};

// Browse entry → /search source in one step (the /search rail feeds on the same
// /api/v1/schemas/browse payload as /schemas). Nameless entries drop out via
// entryToCardSource; mirrors and fieldless shapes via toSearchSource.
export const entryToSearchSource = (entry: BrowseSchemaEntry): SchemaSource | null => {
  const card = entryToCardSource(entry);
  return card ? toSearchSource(card) : null;
};
