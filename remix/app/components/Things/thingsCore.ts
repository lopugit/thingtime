// Shared vocabulary for the /things page — types, display helpers, and the
// localCache shape. Pure module (no React) so views/dialogs/tests can all
// import it without dragging component code along.

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

// Cached page state for optimistic first paint (localCache tier — see the
// optimistic-rendering house rule in CLAUDE.md). Keyed per user so switching
// accounts never leaks another account's listing.
export type ThingsCache = {
  view?: ThingsView;
  displayMode?: ThingsDisplayMode;
  // first page per folder key ('root' or the folder shareId)
  folders?: Record<string, ThingsThing[]>;
  // folder shareId → its display facts (breadcrumbs/tree paint from this)
  folderMeta?: Record<string, { name: string; icon?: string; folderId: string | null }>;
};

export const thingsCacheKey = (userId: string | null | undefined) => `tt-things-${userId || 'anon'}`;

export const folderKeyOf = (folderId: string | null) => folderId || 'root';

export const isFolder = (thing: Pick<ThingsThing, 'thingtime'>): boolean => thing.thingtime.includes('folder');

// The kinds the page lets you filter by; 'all' = no thingtime filter. Kept to
// kinds the listing can actually contain (protected kinds never appear).
export const THINGS_KIND_FILTERS = [
  { id: 'all', label: 'All', icon: '🌀' },
  { id: 'folder', label: 'Folders', icon: '📁' },
  { id: 'post', label: 'Posts', icon: '📝' },
  { id: 'data', label: 'Data', icon: '📦' },
  { id: 'schema', label: 'Schemas', icon: '💎' },
  { id: 'comment', label: 'Comments', icon: '💬' }
] as const;
export type ThingsKindFilter = (typeof THINGS_KIND_FILTERS)[number]['id'];

const KIND_ICONS: Record<string, string> = {
  folder: '📁',
  post: '📝',
  comment: '💬',
  reaction: '😊',
  share: '🔁',
  save: '🔖',
  data: '📦',
  schema: '💎'
};

// primary kind for labels/icons: the most specific schema wins over 'post'
const PRIMARY_KIND_ORDER = ['folder', 'share', 'comment', 'reaction', 'save', 'schema', 'data', 'post'];

export const primaryKindOf = (thing: Pick<ThingsThing, 'thingtime'>): string =>
  PRIMARY_KIND_ORDER.find((kind) => thing.thingtime.includes(kind)) || thing.thingtime[0] || 'data';

export const thingIcon = (thing: Pick<ThingsThing, 'thingtime' | 'crystal'>): string => {
  if (isFolder(thing) && typeof thing.crystal?.icon === 'string' && thing.crystal.icon) return thing.crystal.icon;
  return KIND_ICONS[primaryKindOf(thing)] || '🌀';
};

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

// permalink for the share dialog's copy-link: posts have a page of their own,
// everything else deep-links into the /things preview modal
export const thingLink = (thing: Pick<ThingsThing, 'id' | 'thingtime'>): string =>
  thing.thingtime.includes('post') ? `/post/${thing.id}` : `/things?preview=${encodeURIComponent(thing.id)}`;

// stable sort for browse views: folders first (Drive convention), then newest
export const sortForBrowse = (things: ThingsThing[]): ThingsThing[] =>
  [...things].sort((a, b) => {
    const aFolder = isFolder(a) ? 0 : 1;
    const bFolder = isFolder(b) ? 0 : 1;
    if (aFolder !== bFolder) return aFolder - bFolder;
    return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
  });
