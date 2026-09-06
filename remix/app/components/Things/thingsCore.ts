// Shared vocabulary for the /things page — types, display helpers, and the
// localCache shape. Pure module (no React) so views/dialogs/tests can all
// import it without dragging component code along.

import { primaryKindOf, THING_KIND_ICONS } from './thingIcon';

export { FILE_TYPE_ICON_RULES, THING_KIND_ICONS, fileIconForThing, primaryKindOf, thingIcon } from './thingIcon';

export type ThingsAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
} | null;

// PublicThing as the /things page consumes it (see api/utils/things/things.ts)
export type ThingsThing = {
  id: string;
  thingtime: string[];
  author: ThingsAuthor;
  visibility: string;
  acl: string[];
  targetId: string | null;
  folderId: string | null;
  crystal: Record<string, any>;
  extended: unknown | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ThingsView = 'grid' | 'list' | 'columns';

// Orthogonal to the view type: 'name' shows filename + kind icon everywhere,
// 'preview' live-renders each thing through the kind system (falling back to
// name style per item when nothing resolves).
export type ThingsDisplayMode = 'name' | 'preview';

export type ThingsClipboard = { mode: 'copy' | 'cut'; ids: string[] } | null;

// How the current folder is ordered. Folders always sort first (Drive
// convention); the sort applies within each block. Sorting is client-side over
// the loaded window — the page eagerly loads the folder's remaining pages
// (bounded) whenever a non-default sort/group is active so the order is honest.
export type ThingsSort = 'newest' | 'oldest' | 'name' | 'name-desc' | 'kind';
export type ThingsGroupBy = 'none' | 'kind';

export const THINGS_SORT_OPTIONS: { id: ThingsSort; label: string; icon: string; lucide: string }[] = [
  { id: 'newest', label: 'Newest first', icon: '🌱', lucide: 'clock-arrow-down' },
  { id: 'oldest', label: 'Oldest first', icon: '🌳', lucide: 'clock-arrow-up' },
  { id: 'name', label: 'Name A–Z', icon: '🔤', lucide: 'arrow-down-a-z' },
  { id: 'name-desc', label: 'Name Z–A', icon: '🔡', lucide: 'arrow-up-z-a' },
  { id: 'kind', label: 'Kind', icon: '💠', lucide: 'shapes' }
];

export const THINGS_GROUP_OPTIONS: { id: ThingsGroupBy; label: string; icon: string; lucide: string }[] = [
  { id: 'none', label: 'No grouping', icon: '➖', lucide: 'minus' },
  { id: 'kind', label: 'By kind', icon: '🗂️', lucide: 'layers' }
];

// Cached page state for optimistic first paint (localCache tier — see the
// optimistic-rendering house rule in CLAUDE.md). Keyed per user so switching
// accounts never leaks another account's listing.
export type ThingsCache = {
  view?: ThingsView;
  displayMode?: ThingsDisplayMode;
  sort?: ThingsSort;
  groupBy?: ThingsGroupBy;
  // first page per folder key ('root' or the folder shareId)
  folders?: Record<string, ThingsThing[]>;
  // folder shareId → its display facts (breadcrumbs/tree paint from this)
  folderMeta?: Record<string, { name: string; icon?: string; folderId: string | null }>;
  // schema shareId → its render template (null = fetched, has none) so
  // Previews paint instantly on revisit
  schemaRenders?: Record<string, Record<string, unknown> | null>;
};

export const thingsCacheKey = (userId: string | null | undefined) => `tt-things-${userId || 'anon'}`;

export const folderKeyOf = (folderId: string | null) => folderId || 'root';

export const isFolder = (thing: Pick<ThingsThing, 'thingtime'>): boolean => thing.thingtime.includes('folder');

// Kinds the server refuses to copy (mirrors UNCOPYABLE in
// api/utils/things/things.ts): attached children live under their target — a
// duplicate would dangle. The menu hides Duplicate for these instead of
// offering an action that can only fail.
export const UNCOPYABLE_KINDS = ['comment', 'reaction', 'save', 'share', 'vote'] as const;

export const isDuplicable = (thing: Pick<ThingsThing, 'thingtime'>): boolean =>
  !UNCOPYABLE_KINDS.some((kind) => thing.thingtime.includes(kind));

// The kinds the page lets you filter by; 'all' = no thingtime filter. Kept to
// kinds the listing can actually contain (protected kinds never appear).
export const THINGS_KIND_FILTERS = [
  { id: 'all', label: 'All', icon: '🌀' },
  { id: 'folder', label: 'Folders', icon: '📁' },
  { id: 'post', label: 'Posts', icon: '📝' },
  { id: 'data', label: 'Data', icon: '📦' },
  { id: 'schema', label: 'Schemas', icon: '💎' },
  { id: 'component', label: 'Components', icon: '🧩' },
  { id: 'action', label: 'Actions', icon: '⚡' },
  { id: 'comment', label: 'Comments', icon: '💬' }
] as const;
export type ThingsKindFilter = (typeof THINGS_KIND_FILTERS)[number]['id'];

const firstLine = (value: string, max = 80): string => {
  const line = value.split('\n').find((entry) => entry.trim()) || '';
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
};

// Drive-style display name, best-effort per kind. Every fallback is honest
// about what the thing is instead of rendering an empty row.
export const thingDisplayName = (thing: Pick<ThingsThing, 'thingtime' | 'crystal'>): string => {
  const crystal = thing.crystal || {};
  for (const key of ['name', 'title']) {
    if (typeof crystal[key] === 'string' && crystal[key].trim()) return firstLine(crystal[key]);
  }
  if (typeof crystal.text === 'string' && crystal.text.trim()) return firstLine(crystal.text);
  const kind = primaryKindOf(thing);
  if (kind === 'post' && Array.isArray(crystal.images) && crystal.images.length) {
    return `Image post (${crystal.images.length})`;
  }
  if (kind === 'share') return 'Shared thing';
  if (kind === 'reaction' && typeof crystal.emoji === 'string') return `Reaction ${crystal.emoji}`;
  return `Untitled ${kind}`;
};

export const VISIBILITY_META: Record<string, { label: string; icon: string }> = {
  public: { label: 'Public', icon: '🌐' },
  friends: { label: 'Friends', icon: '🤝' },
  family: { label: 'Family', icon: '🏡' },
  private: { label: 'Private', icon: '🔒' },
  inherit: { label: 'Inherits', icon: '🔗' }
};

// legacy circle names → acl arrays (mirrors LEGACY_VISIBILITY_ACLS in
// schemas/registry.ts — the share dialog composes person grants on top)
export const CIRCLE_BASE_ACLS: Record<string, string[]> = {
  public: ['tt:all'],
  friends: ['-tt:all', 'tt:userFriends', 'tt:user'],
  family: ['-tt:all', 'tt:userFamily', 'tt:user'],
  private: ['tt:user']
};

export const personGrantsOf = (acl: string[]): string[] =>
  acl
    .filter((entry) => entry.startsWith('tt:user/'))
    .map((entry) => entry.slice('tt:user/'.length));

export const circleOf = (acl: string[]): string => {
  if (acl.includes('tt:inherit')) return 'inherit';
  if (acl.includes('tt:all')) return 'public';
  if (acl.includes('tt:userFriends')) return 'friends';
  if (acl.includes('tt:userFamily')) return 'family';
  return 'private';
};

export const composeAcl = (circle: string, people: string[]): string[] => {
  const base = CIRCLE_BASE_ACLS[circle] || CIRCLE_BASE_ACLS.private;
  const grants = people.map((username) => `tt:user/${username}`);
  return [...base, ...grants].filter((entry, index, all) => all.indexOf(entry) === index);
};

export const formatWhen = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return date.toLocaleDateString();
};

// Where a thing's OWN page lives — the permalink Copy link / Share hand out
// and the page a double-click opens, so a pasted link and an opened tile
// land on the same surface. Every kind with a dedicated page routes there
// (folders open in place on /things); components, data and whatever kind
// comes next land on the universal /thing/:id page. The /things?preview=
// deep link stays the explicit quick-look, never the permalink.
export const thingLink = (thing: Pick<ThingsThing, 'id' | 'thingtime'>): string => {
  const id = encodeURIComponent(thing.id);
  if (thing.thingtime.includes('folder')) return `/things?folder=${id}`;
  if (thing.thingtime.includes('post')) return `/post/${id}`;
  if (thing.thingtime.includes('action')) return `/actions/${id}`;
  if (thing.thingtime.includes('webpage')) return `/p/${id}`;
  if (thing.thingtime.includes('schema')) return `/schemas/${id}`;
  return `/thing/${id}`;
};

// The surfaces the universal page can send a viewer back to.
export type ThingsReferrer = 'things' | 'actions' | 'feed';

// The href a browse surface NAVIGATES to: the permalink plus the referrer
// hint the universal /thing/:id page reads for its back link. Only that page
// consumes the hint, so dedicated pages (post/action/webpage/schema) and the
// shareable permalink itself never carry it.
export const thingOpenHref = (thing: Pick<ThingsThing, 'id' | 'thingtime'>, from: ThingsReferrer): string => {
  const href = thingLink(thing);
  return href.startsWith('/thing/') ? `${href}?from=${from}` : href;
};

// stable sort for browse views: folders first (Drive convention), then the
// chosen order. Every comparator ends on id so the order is deterministic.
export const sortThings = (things: ThingsThing[], sort: ThingsSort = 'newest'): ThingsThing[] =>
  [...things].sort((a, b) => {
    const aFolder = isFolder(a) ? 0 : 1;
    const bFolder = isFolder(b) ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    switch (sort) {
      case 'oldest':
        return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      case 'name':
        return (
          thingDisplayName(a).localeCompare(thingDisplayName(b), undefined, { sensitivity: 'base', numeric: true }) ||
          a.id.localeCompare(b.id)
        );
      case 'name-desc':
        return (
          thingDisplayName(b).localeCompare(thingDisplayName(a), undefined, { sensitivity: 'base', numeric: true }) ||
          a.id.localeCompare(b.id)
        );
      case 'kind': {
        const order = primaryKindOf(a).localeCompare(primaryKindOf(b));
        if (order) return order;
        return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
      }
      default:
        return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
    }
  });

export const sortForBrowse = (things: ThingsThing[]): ThingsThing[] => sortThings(things, 'newest');

// Group an (already sorted) list into presentation sections. Groups keep the
// incoming order inside themselves; group order follows PRIMARY_KIND_ORDER so
// folders lead and rare kinds trail.
export type ThingsGroup = { key: string; label: string; icon: string; items: ThingsThing[] };

// content-first section order + honest plurals ('data' has no plural)
const KIND_GROUP_ORDER = ['folder', 'post', 'data', 'schema', 'comment', 'share', 'reaction', 'save'];
const KIND_GROUP_LABELS: Record<string, string> = {
  folder: 'Folders',
  post: 'Posts',
  data: 'Data',
  schema: 'Schemas',
  comment: 'Comments',
  share: 'Shares',
  reaction: 'Reactions',
  save: 'Saves'
};

export const groupThings = (things: ThingsThing[], groupBy: ThingsGroupBy): ThingsGroup[] => {
  if (groupBy !== 'kind') return [{ key: 'all', label: 'All', icon: '🌀', items: things }];
  const byKind = new Map<string, ThingsThing[]>();
  for (const thing of things) {
    const kind = primaryKindOf(thing);
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(thing);
    else byKind.set(kind, [thing]);
  }
  const orderedKinds = [
    ...KIND_GROUP_ORDER.filter((kind) => byKind.has(kind)),
    ...[...byKind.keys()].filter((kind) => !KIND_GROUP_ORDER.includes(kind))
  ];
  return orderedKinds.map((kind) => ({
    key: kind,
    label: KIND_GROUP_LABELS[kind] || `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`,
    icon: THING_KIND_ICONS[kind] || '🌀',
    items: byKind.get(kind) || []
  }));
};

// The community schema a data thing was created with (crystal.schemaId is the
// schema thing's shareId, stamped server-side by the provenance check) — the
// hook Previews use to render the thing through its schema's render template.
export const schemaIdOf = (thing: Pick<ThingsThing, 'thingtime' | 'crystal'>): string | null =>
  thing.thingtime.includes('data') && typeof thing.crystal?.schemaId === 'string' && thing.crystal.schemaId
    ? thing.crystal.schemaId
    : null;

// The render template a SCHEMA thing declares (crystal.render, an object
// tree), null when it has none or the response is not a schema. One reader
// for the /things Previews cache and the universal /thing/:id page, so a data
// thing draws through exactly the same template on both.
export const schemaRenderOf = (schemaThing: unknown): Record<string, unknown> | null => {
  const thing = schemaThing as { thingtime?: unknown; crystal?: { render?: unknown } | null } | null;
  if (!thing || !Array.isArray(thing.thingtime) || !thing.thingtime.includes('schema')) return null;
  const render = thing.crystal?.render;
  return render && typeof render === 'object' && !Array.isArray(render) ? (render as Record<string, unknown>) : null;
};

// {field} token interpolation for schema render templates: every string in the
// tree (props and children alike) swaps {dotted.path} tokens for the data
// thing's crystal values. Runs BEFORE the sanitising Chakra/Html renderers, so
// substituted values still pass the same URL/CSS gates as authored strings.
const RENDER_TOKEN = /\{([A-Za-z0-9_][A-Za-z0-9_.-]*)\}/g;
const MAX_INTERPOLATE_NODES = 800;

const crystalValueAt = (crystal: Record<string, any>, path: string): unknown => {
  let cursor: unknown = crystal;
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
};

const interpolateString = (value: string, crystal: Record<string, any>): string =>
  value.replace(RENDER_TOKEN, (token, path: string) => {
    const resolved = crystalValueAt(crystal, path);
    if (resolved === undefined || resolved === null) return '';
    if (typeof resolved === 'object') {
      try {
        return JSON.stringify(resolved);
      } catch {
        return '';
      }
    }
    return String(resolved);
  });

export const interpolateRenderTree = (
  tree: Record<string, unknown>,
  crystal: Record<string, any>
): Record<string, unknown> => {
  const state = { count: 0 };
  const walk = (node: unknown): unknown => {
    if (state.count > MAX_INTERPOLATE_NODES) return node;
    state.count += 1;
    if (typeof node === 'string') return interpolateString(node, crystal);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) out[key] = walk(value);
      return out;
    }
    return node;
  };
  return walk(tree) as Record<string, unknown>;
};
