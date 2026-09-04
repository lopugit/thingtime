import type { ComponentArgSpec } from './componentTemplate';
import { sanitizeArgSpecs } from './componentTemplate';

// Client-side mirrors of /api/v1/components/browse shapes (server source of
// truth: app/api/utils/components/browse.ts). Same author/entry surface as
// the schemas browse family so cards can share display conventions.

export type BrowseComponentAuthor = {
  id: string;
  username: string;
  displayName: string | null;
  temporary?: boolean;
  avatarUrl: string | null;
} | null;

export type ComponentDesignRef = { id: string; library: string };

export type BrowseComponentEntry = {
  id: string;
  thingtime: string[];
  author: BrowseComponentAuthor;
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
  // group=family pages: every visible design of this entry's family
  designs?: ComponentDesignRef[];
};

export type BrowseComponentsResponse = {
  ok: boolean;
  error?: string;
  components: BrowseComponentEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

export const COMPONENT_LIBRARY_LABELS: Record<string, string> = {
  antd: 'Ant Design',
  bootstrap: 'Bootstrap',
  mui: 'MUI',
  shadcn: 'shadcn/ui',
  untitled: 'Untitled UI',
  daisyui: 'daisyUI',
  reactflow: 'React Flow',
  thingtime: 'Thingtime',
  custom: 'Custom'
};

// One card model. System-seeded library components resolve to a null author
// (ownerId 'system' is never a real user), which is how cards tell the
// platform catalog apart from community publishes.
export type ComponentCardSource = {
  key: string; // stable list key (thing shareId — or familyKey on grouped pages)
  id: string;
  name: string;
  description: string;
  library: string;
  category: string;
  componentKey: string | null;
  familyKey: string | null;
  version: number | null;
  args: ComponentArgSpec[];
  savedArgs: Record<string, string | number | boolean> | null;
  render: unknown;
  previewBg: string | null;
  forkOf: string | null;
  origin: 'platform' | 'community';
  entry: BrowseComponentEntry;
  // the family's design roster (>1 → the card shows the designs click-through)
  designs: ComponentDesignRef[];
  // thing-level tags (provenance + library + category + per-component topics)
  tags: string[];
};

// canonical design order: house style first, then the source libraries
export const DESIGN_LIBRARY_ORDER = ['thingtime', 'antd', 'bootstrap', 'mui', 'shadcn', 'untitled', 'daisyui', 'reactflow', 'custom'];
export const designRank = (library: string): number => {
  const index = DESIGN_LIBRARY_ORDER.indexOf(library);
  return index === -1 ? DESIGN_LIBRARY_ORDER.length : index;
};

// the deep-link key for a card: family page when grouped, else the design slug
export const deepLinkKeyFor = (source: Pick<ComponentCardSource, 'familyKey' | 'componentKey' | 'id'>): string =>
  source.familyKey || source.componentKey || source.id;

export const entryToCardSource = (entry: BrowseComponentEntry): ComponentCardSource | null => {
  const crystal = entry.crystal || {};
  const name = typeof crystal.name === 'string' ? crystal.name : '';
  if (!name || !crystal.render || typeof crystal.render !== 'object') return null;
  const savedArgs =
    crystal.savedArgs && typeof crystal.savedArgs === 'object' && !Array.isArray(crystal.savedArgs)
      ? (crystal.savedArgs as Record<string, string | number | boolean>)
      : null;
  return {
    key: entry.id,
    id: entry.id,
    name,
    description: typeof crystal.description === 'string' ? crystal.description : '',
    library: typeof crystal.library === 'string' ? crystal.library : 'custom',
    category: typeof crystal.category === 'string' ? crystal.category : 'general',
    componentKey: typeof crystal.componentKey === 'string' ? crystal.componentKey : null,
    familyKey: typeof crystal.familyKey === 'string' ? crystal.familyKey : null,
    version: typeof crystal.version === 'number' ? crystal.version : null,
    args: sanitizeArgSpecs(crystal.args),
    savedArgs,
    render: crystal.render,
    previewBg: typeof crystal.previewBg === 'string' ? crystal.previewBg : null,
    forkOf: typeof crystal.forkOf === 'string' ? crystal.forkOf : null,
    origin: entry.author ? 'community' : 'platform',
    entry,
    designs: Array.isArray(entry.designs) ? entry.designs : [],
    tags: Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string') : []
  };
};

// Provenance tags read as attribution, not topics — the UI gives them their
// own chip treatment ahead of the topical tags.
export const ATTRIBUTION_TAG_PATTERN = /^made by /i;
export const isAttributionTag = (tag: string): boolean => ATTRIBUTION_TAG_PATTERN.test(tag);

// Client-side family collapse for pages the server can't group (q-search):
// one source per familyKey from the loaded entries, representative by design
// rank, designs built from what's loaded (the full roster hydrates on switch).
export const collapseEntriesByFamily = (entries: BrowseComponentEntry[]): ComponentCardSource[] => {
  const byFamily = new Map<string, BrowseComponentEntry[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const familyKey = typeof entry.crystal?.familyKey === 'string' ? entry.crystal.familyKey : entry.id;
    if (!byFamily.has(familyKey)) {
      byFamily.set(familyKey, []);
      order.push(familyKey);
    }
    byFamily.get(familyKey)!.push(entry);
  }
  const sources: ComponentCardSource[] = [];
  for (const familyKey of order) {
    const group = byFamily.get(familyKey)!;
    const ranked = [...group].sort(
      (a, b) =>
        designRank(typeof a.crystal?.library === 'string' ? a.crystal.library : 'custom') -
          designRank(typeof b.crystal?.library === 'string' ? b.crystal.library : 'custom') || (a.id < b.id ? -1 : 1)
    );
    const source = entryToCardSource(ranked[0]);
    if (!source) continue;
    if (group.length > 1) {
      source.designs = ranked.map((entry) => ({
        id: entry.id,
        library: typeof entry.crystal?.library === 'string' ? entry.crystal.library : 'custom'
      }));
    }
    source.key = familyKey;
    sources.push(source);
  }
  return sources;
};
