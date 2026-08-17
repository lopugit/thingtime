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
  key: string; // stable list key (thing shareId)
  id: string;
  name: string;
  description: string;
  library: string;
  category: string;
  componentKey: string | null;
  version: number | null;
  args: ComponentArgSpec[];
  savedArgs: Record<string, string | number | boolean> | null;
  render: unknown;
  previewBg: string | null;
  forkOf: string | null;
  origin: 'platform' | 'community';
  entry: BrowseComponentEntry;
};

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
    version: typeof crystal.version === 'number' ? crystal.version : null,
    args: sanitizeArgSpecs(crystal.args),
    savedArgs,
    render: crystal.render,
    previewBg: typeof crystal.previewBg === 'string' ? crystal.previewBg : null,
    forkOf: typeof crystal.forkOf === 'string' ? crystal.forkOf : null,
    origin: entry.author ? 'community' : 'platform',
    entry
  };
};
