import {
  ACTION_KEY_PATTERN,
  DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS,
  MAX_ACTION_KEY_CHARS,
  MAX_WEBPAGE_SOURCE_INTERVAL_MS,
  MIN_WEBPAGE_SOURCE_INTERVAL_MS
} from '~/schemas/registry';

import type { ThingSourceBinding } from '../Builder/liveComponent';
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

// ---------------------------------------------------------------------------
// The dedicated page's trust ladder. Interactivity comes from OWNERSHIP or
// platform curation, never from markup: the viewer's own thing is live with
// no confirm; a system-seeded thing (no author — ownerId 'system' — AND the
// reserved `component-` id prefix user creates refuse) is live behind the
// confirm gate, and when its componentKey names a suite part (demo-/app-
// slugs) that suite must resolve through the registry the caller injects;
// anything else is a stranger's thing and stays inert.

export const RESERVED_COMPONENT_ID_PREFIX = 'component-';
const SUITE_SLUG_PATTERN = /^(demo|app)-/;

export type ComponentTrust = 'owner' | 'seeded' | 'stranger';

export const componentTrustFor = (
  source: { id: string; componentKey: string | null; entry: Pick<BrowseComponentEntry, 'author'> },
  viewerId: string | null | undefined,
  suiteKeyOf: (componentKey: string) => string | null
): { trust: ComponentTrust; suiteKey: string | null } => {
  const authorId = source.entry.author?.id || null;
  const suiteKey = source.componentKey ? suiteKeyOf(source.componentKey) : null;
  if (viewerId && authorId === viewerId) return { trust: 'owner', suiteKey };
  const systemOwned = !authorId && source.id.startsWith(RESERVED_COMPONENT_ID_PREFIX);
  const suitePart = !!source.componentKey && SUITE_SLUG_PATTERN.test(source.componentKey);
  if (systemOwned && (!suitePart || suiteKey)) return { trust: 'seeded', suiteKey };
  return { trust: 'stranger', suiteKey };
};

// The design the page lands on: an explicit ?design= (a library, or a thing
// id when a family holds two renditions of one library), else the entry the
// URL key names — the viewer's OWN copy ahead of the seeded one, the way
// /p/<pageKey> resolves an installed twin ahead of the platform page — else
// the first by design rank.
export const pickActiveSource = (
  sources: ComponentCardSource[],
  options: { design: string; key: string; viewerId: string | null | undefined }
): ComponentCardSource | null => {
  if (!sources.length) return null;
  const own = (source: ComponentCardSource) => !!options.viewerId && source.entry.author?.id === options.viewerId;
  if (options.design) {
    const exact = sources.find((source) => source.id === options.design);
    if (exact) return exact;
    const byLibrary = sources.filter((source) => source.library === options.design);
    if (byLibrary.length) return byLibrary.find(own) || byLibrary[0];
  }
  const keyed = sources.filter(
    (source) => source.componentKey === options.key || source.familyKey === options.key || source.id === options.key
  );
  if (keyed.length) return keyed.find(own) || keyed[0];
  return sources.find(own) || sources[0];
};

// A code-catalog component (a behaviour/app suite part materialised on the
// client) as a browse entry, so the dedicated page can paint it before the
// fetch lands — the house optimistic-render rule. Reconciled by the API.
export const catalogEntryFrom = (shareId: string, crystal: Record<string, unknown>): BrowseComponentEntry => ({
  id: shareId,
  thingtime: ['component'],
  author: null,
  visibility: 'public',
  acl: ['tt:all'],
  targetId: null,
  crystal,
  tags: [],
  createdAt: '',
  updatedAt: '',
  reactionCounts: {},
  viewerReactions: [],
  saved: false,
  usageCount: 0
});

// ---------------------------------------------------------------------------
// The page's DATA SOURCE binding lives in the URL (?source=<actionKey>
// &refresh=manual|interval&interval=<ms>&inputs=<json>) so a bound page is
// shareable and NEVER written to the thing. The values are exactly what a
// webpage block's `source` carries (ThingSourceBinding) and the same gates
// apply: an actionKey slug, a bounded interval, scalar inputs.

export const SOURCE_PARAM_KEYS = ['source', 'refresh', 'interval', 'inputs'] as const;
export type SourceRefreshMode = NonNullable<ThingSourceBinding['refresh']>;
export const SOURCE_REFRESH_MODES: SourceRefreshMode[] = ['load', 'manual', 'interval'];
const MAX_SOURCE_INPUT_KEYS = 32;
const MAX_SOURCE_INPUT_CHARS = 4000;
const SOURCE_INPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;

export const isSourceActionKey = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_ACTION_KEY_CHARS && ACTION_KEY_PATTERN.test(value);

export const clampSourceInterval = (raw: unknown): number => {
  const value = Number(raw);
  if (!Number.isFinite(value)) return DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS;
  return Math.max(MIN_WEBPAGE_SOURCE_INTERVAL_MS, Math.min(MAX_WEBPAGE_SOURCE_INTERVAL_MS, Math.round(value)));
};

export type SourceInputs = Record<string, string | number | boolean>;

export const parseSourceInputsJson = (raw: string): { ok: true; inputs: SourceInputs | undefined } | { ok: false; error: string } => {
  const text = (raw || '').trim();
  if (!text) return { ok: true, inputs: undefined };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Inputs must be a JSON object' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'Inputs must be a JSON object' };
  const inputs: SourceInputs = {};
  let count = 0;
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!SOURCE_INPUT_KEY_PATTERN.test(name)) return { ok: false, error: `Input name “${name}” must be a simple identifier` };
    if (typeof value === 'string') {
      if (value.length > MAX_SOURCE_INPUT_CHARS) return { ok: false, error: `Input “${name}” is too long` };
      inputs[name] = value;
    } else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') {
      inputs[name] = value;
    } else {
      return { ok: false, error: `Input “${name}” must be a string, number, or boolean` };
    }
    count += 1;
    if (count > MAX_SOURCE_INPUT_KEYS) return { ok: false, error: `At most ${MAX_SOURCE_INPUT_KEYS} inputs` };
  }
  return { ok: true, inputs: count ? inputs : undefined };
};

export const parseSourceBindingParams = (params: URLSearchParams): ThingSourceBinding | null => {
  const action = (params.get('source') || '').trim();
  if (!isSourceActionKey(action)) return null;
  const refreshRaw = params.get('refresh') || '';
  const refresh = (SOURCE_REFRESH_MODES as string[]).includes(refreshRaw) ? (refreshRaw as SourceRefreshMode) : 'load';
  const parsedInputs = parseSourceInputsJson(params.get('inputs') || '');
  return {
    action,
    refresh,
    ...(refresh === 'interval' ? { intervalMs: clampSourceInterval(params.get('interval')) } : {}),
    ...(parsedInputs.ok && parsedInputs.inputs ? { inputs: parsedInputs.inputs } : {})
  };
};

// A copy of `params` with the binding written (or, for null, cleared) — every
// other param (design) survives.
export const sourceBindingToParams = (params: URLSearchParams, binding: ThingSourceBinding | null): URLSearchParams => {
  const next = new URLSearchParams(params);
  for (const param of SOURCE_PARAM_KEYS) next.delete(param);
  if (!binding || !isSourceActionKey(binding.action)) return next;
  next.set('source', binding.action);
  if (binding.refresh && binding.refresh !== 'load') next.set('refresh', binding.refresh);
  if (binding.refresh === 'interval') next.set('interval', String(clampSourceInterval(binding.intervalMs)));
  if (binding.inputs && Object.keys(binding.inputs).length) next.set('inputs', JSON.stringify(binding.inputs));
  return next;
};
