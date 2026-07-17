import type { SchemaThingField, ThingtimeSchema } from '~/schemas/registry';

// Client-side mirrors of /api/v1/schemas/browse shapes (server source of
// truth: app/api/utils/schemas/browse.ts).

export type BrowseSchemaAuthor = {
  id: string;
  username: string;
  displayName: string | null;
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
export const SEARCHABLE_CRYSTAL_KINDS = new Set(['post', 'data', 'schema', 'comment', 'reaction']);

export const searchableSchemaSource = (source: Pick<SchemaCardSource, 'origin' | 'id'>): boolean =>
  source.origin === 'community' || SEARCHABLE_CRYSTAL_KINDS.has(source.id);

export const registryToCardSource = (schema: ThingtimeSchema): SchemaCardSource => ({
  key: `builtin:${schema.id}`,
  origin: 'builtin',
  id: schema.id,
  name: schema.title,
  description: schema.summary,
  fields: (schema.fields || []) as unknown as SchemaThingField[],
  registry: schema
});
