import React from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Grid,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Text
} from '@chakra-ui/react';
import { BookOpen, Columns3, GitFork, LayoutGrid, Library, Plus, Rows3, Search, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';

import { Rainbow } from '~/components/Rainbow/Rainbow';
import { RenderThing } from '~/components/Kinds';
import { EmojiPicker } from '~/components/Emoji/EmojiPicker';
import { useRecentReactions } from '~/components/Emoji/useRecentReactions';
import { timeAgo } from '~/components/Feed/feedTypes';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { crystalSchemas } from '~/schemas/registry';
import { describeSchemaField, flattenSchemaFields, generateSampleFromFields } from '~/schemas/tools';

import { SchemaBuilder, type BuilderPrefill } from './SchemaBuilder';
import { SchemaThingForm } from './SchemaThingForm';
import {
  entryToCardSource,
  registryToCardSource,
  type BrowseSchemaEntry,
  type BrowseSchemasResponse,
  type SchemaCardSource
} from './schemaBrowseTypes';

const CACHE_KEY = 'tt-schemas';
const PAGE_SIZE = 20;

type ViewMode = 'feed' | 'grid' | 'columns';
type SortMode = 'newest' | 'popular' | 'oldest';
type ScopeMode = 'all' | 'mine' | 'library';

type CachedSchemas = {
  q: string;
  sort: SortMode;
  view: ViewMode;
  scope: ScopeMode;
  entries: BrowseSchemaEntry[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
};

// kind the renderer registry might know this schema as (e.g. "Post" → post,
// "News analysis" → news-analysis)
const kindOf = (name: string) => name.toLowerCase().trim().replace(/\s+/g, '-');

const pillProps = (active: boolean) =>
  ({
    background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, #ffffff)',
    border: '1px solid var(--tt-border, #ececef)',
    borderRadius: 'full',
    color: active ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #33333c)',
    fontSize: '12px',
    fontWeight: 600,
    height: '28px',
    paddingX: 3,
    _hover: { background: active ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }
  }) as const;

const monoLabel = {
  color: 'var(--tt-muted, #9a9aa6)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const
};

// ---------------------------------------------------------------------------
// Sample preview: rendered via the kind registry when a renderer exists for
// the schema's name, else an honest generated-sample chip card.

const SamplePreview = ({ source }: { source: SchemaCardSource }) => {
  const sample = React.useMemo(() => generateSampleFromFields(source.fields), [source.fields]);
  const entries = React.useMemo(
    () =>
      Object.entries(sample)
        .slice(0, 8)
        .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)] as const),
    [sample]
  );
  if (!entries.length) {
    return (
      <Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
        No fields yet — fork it and add some ✨
      </Text>
    );
  }
  return (
    <Flex direction="column" gap={1.5}>
      {entries.map(([key, value]) => (
        <Flex align="baseline" gap={2} key={key} minWidth={0}>
          <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
            {key}
          </Text>
          <Text color="var(--tt-text, #33333c)" fontSize="13px" noOfLines={1}>
            {value.slice(0, 160)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
};

const SampleRender = ({ source }: { source: SchemaCardSource }) => {
  const thing = React.useMemo(
    () => ({ kind: kindOf(source.name), ...generateSampleFromFields(source.fields) }),
    [source.name, source.fields]
  );
  return (
    <Box
      background="var(--tt-surface, #fafafb)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-md, 12px)"
      overflow="hidden"
      padding={3}
    >
      <RenderThing context={{ size: 'card' }} fallback={<SamplePreview source={source} />} thing={thing} />
    </Box>
  );
};

// ---------------------------------------------------------------------------
// One schema card, shared by every view mode.

type SchemaCardProps = {
  source: SchemaCardSource;
  onReact: (source: SchemaCardSource, token: string) => void;
  onSave: (source: SchemaCardSource) => void;
  onFork: (source: SchemaCardSource) => void;
  onCreateThing: (source: SchemaCardSource) => void;
  onSearchThings: (source: SchemaCardSource) => void;
};

const SchemaCard = React.memo(({ source, onReact, onSave, onFork, onCreateThing, onSearchThings }: SchemaCardProps) => {
  const entry = source.entry;
  const flat = React.useMemo(() => flattenSchemaFields(source.fields), [source.fields]);
  const { recent } = useRecentReactions();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const reactionEntries = Object.entries(entry?.reactionCounts || {}).filter(([, count]) => count > 0);

  return (
    <Flex
      background="var(--tt-card, #ffffff)"
      border="1px solid var(--tt-border, #ececef)"
      borderRadius="var(--tt-radius-lg, 16px)"
      direction="column"
      gap={3}
      padding={4}
      sx={{ breakInside: 'avoid' }}
    >
      <Flex align="center" gap={2} wrap="wrap">
        <Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={700}>
          {source.name}
        </Text>
        <Badge
          background={source.origin === 'builtin' ? 'var(--tt-surface-alt, #f5f5f7)' : 'var(--tt-surface, #fafafb)'}
          border="1px solid var(--tt-border, #ececef)"
          borderRadius="full"
          color="var(--tt-muted, #9a9aa6)"
          fontSize="10px"
          paddingX={2}
          textTransform="none"
        >
          {source.origin === 'builtin' ? '🏛 Platform' : '🌱 Community'}
        </Badge>
        {entry && entry.usageCount > 0 && (
          <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
            {entry.usageCount} thing{entry.usageCount === 1 ? '' : 's'} use this
          </Badge>
        )}
        {source.forkOf && (
          <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
            forked
          </Badge>
        )}
        <Box flex={1} />
        {entry && (
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
            {entry.author?.displayName || entry.author?.username || 'anon'} · {timeAgo(entry.createdAt)}
          </Text>
        )}
      </Flex>

      {source.description && (
        <Text color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.55">
          {source.description}
        </Text>
      )}

      {flat.length > 0 && (
        <Flex gap={1.5} wrap="wrap">
          {flat.slice(0, 8).map((field) => (
            <Flex
              align="center"
              background="var(--tt-surface-alt, #f5f5f7)"
              borderRadius="var(--tt-radius-xs, 7px)"
              gap={1.5}
              key={field.path}
              paddingX={2}
              paddingY={0.5}
            >
              <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
                {field.path}
              </Text>
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="10px">
                {describeSchemaField(field.field)}
                {field.field.required ? ' *' : ''}
              </Text>
            </Flex>
          ))}
          {flat.length > 8 && (
            <Text alignSelf="center" color="var(--tt-faint, #b6b6c0)" fontSize="11px">
              +{flat.length - 8} more
            </Text>
          )}
        </Flex>
      )}

      <SampleRender source={source} />

      {entry && (
        <Flex align="center" gap={1.5} wrap="wrap">
          {reactionEntries.map(([token, count]) => {
            const mine = entry.viewerReactions.includes(token);
            return (
              <Button
                background={mine ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                height="26px"
                key={token}
                minWidth={0}
                onClick={() => onReact(source, token)}
                paddingX={2}
                size="xs"
                variant="unstyled"
              >
                <Flex align="center" gap={1}>
                  <Text fontSize="13px">{token}</Text>
                  <Text color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                    {count}
                  </Text>
                </Flex>
              </Button>
            );
          })}
          <Popover isLazy isOpen={pickerOpen} onClose={() => setPickerOpen(false)} placement="top-start">
            <PopoverTrigger>
              <Button
                border="1px dashed var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-muted, #9a9aa6)"
                height="26px"
                onClick={() => setPickerOpen((open) => !open)}
                paddingX={2}
                size="xs"
                variant="unstyled"
              >
                <Flex align="center" gap={1}>
                  <Plus size={12} /> react
                </Flex>
              </Button>
            </PopoverTrigger>
            <PopoverContent border="1px solid var(--tt-border, #ececef)" width="320px">
              <PopoverBody padding={2}>
                <EmojiPicker
                  activeTokens={entry.viewerReactions}
                  autoFocus
                  onPick={(token) => {
                    setPickerOpen(false);
                    onReact(source, token);
                  }}
                  recent={recent}
                />
              </PopoverBody>
            </PopoverContent>
          </Popover>
        </Flex>
      )}

      <Flex gap={2} wrap="wrap">
        {entry && (
          <Button
            leftIcon={<Library size={14} />}
            onClick={() => onSave(source)}
            size="xs"
            variant={entry.saved ? 'solid' : 'outline'}
          >
            {entry.saved ? 'In my library' : 'Add to library'}
          </Button>
        )}
        <Button leftIcon={<Sparkles size={14} />} onClick={() => onCreateThing(source)} size="xs" variant="outline">
          Create a thing
        </Button>
        <Button leftIcon={<Search size={14} />} onClick={() => onSearchThings(source)} size="xs" variant="outline">
          Search things
        </Button>
        <Button leftIcon={<GitFork size={14} />} onClick={() => onFork(source)} size="xs" variant="outline">
          Fork
        </Button>
        {source.origin === 'builtin' && (
          <Button
            as="a"
            href={`/docs/schemas#schema-${source.id}`}
            leftIcon={<BookOpen size={14} />}
            size="xs"
            variant="ghost"
          >
            Docs
          </Button>
        )}
      </Flex>
    </Flex>
  );
});
SchemaCard.displayName = 'SchemaCard';

// ---------------------------------------------------------------------------

export const SchemasBrowsePage = () => {
  const cached = React.useMemo(() => readLocalCache<CachedSchemas>(CACHE_KEY), []);
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();

  const [q, setQ] = React.useState(cached?.q || '');
  const [sort, setSort] = React.useState<SortMode>(cached?.sort || 'newest');
  const [view, setView] = React.useState<ViewMode>(cached?.view || 'feed');
  const [scope, setScope] = React.useState<ScopeMode>(cached?.scope || 'all');
  const [entries, setEntries] = React.useState<BrowseSchemaEntry[]>(cached?.entries || []);
  const [nextCursor, setNextCursor] = React.useState<string | null>(cached?.nextCursor ?? null);
  const [total, setTotal] = React.useState<number | null>(cached?.total ?? null);
  const [totalCapped, setTotalCapped] = React.useState(cached?.totalCapped || false);
  const [loading, setLoading] = React.useState(false);
  const [builderOpen, setBuilderOpen] = React.useState(false);
  const [builderPrefill, setBuilderPrefill] = React.useState<BuilderPrefill | null>(null);
  const [createFor, setCreateFor] = React.useState<SchemaCardSource | null>(null);

  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const requestSeqRef = React.useRef(0);
  const stateRef = React.useRef({ q, sort, scope, loading, nextCursor });
  stateRef.current = { q, sort, scope, loading, nextCursor };

  // Legacy deep links: /schemas#schema-<id> anchors moved to /docs/schemas.
  React.useEffect(() => {
    if (location.hash.startsWith('#schema-')) {
      navigate(`/docs/schemas${location.hash}`, { replace: true });
    }
  }, [location.hash, navigate]);

  const runBrowse = React.useCallback(
    async (options: { cursor?: string | null; qOverride?: string; sortOverride?: SortMode; scopeOverride?: ScopeMode } = {}) => {
      const seq = ++requestSeqRef.current;
      const query = options.qOverride !== undefined ? options.qOverride : stateRef.current.q;
      const sortMode = options.sortOverride || stateRef.current.sort;
      const scopeMode = options.scopeOverride || stateRef.current.scope;
      const cursor = options.cursor || undefined;
      setLoading(true);
      try {
        const resp = (await apiRef.current.v1.schemas.browse({
          q: scopeMode === 'all' ? query.trim() || undefined : undefined,
          sort: scopeMode === 'all' ? sortMode : sortMode === 'oldest' ? 'oldest' : undefined,
          cursor,
          limit: PAGE_SIZE,
          library: scopeMode === 'library' ? 1 : undefined,
          mine: scopeMode === 'mine' ? 1 : undefined
        })) as BrowseSchemasResponse;
        if (seq !== requestSeqRef.current) return;
        if (!resp?.ok) throw resp;

        setEntries((prev) => {
          if (!cursor) return resp.schemas;
          const seen = new Set(prev.map((entry) => entry.id));
          return [...prev, ...resp.schemas.filter((entry) => !seen.has(entry.id))];
        });
        setNextCursor(resp.nextCursor);
        setTotal((prev) => (cursor && resp.total === null ? prev : resp.total));
        setTotalCapped(resp.totalCapped);

        if (!cursor) {
          const snapshot: CachedSchemas = {
            q: query,
            sort: sortMode,
            view,
            scope: scopeMode,
            entries: resp.schemas.slice(0, PAGE_SIZE),
            nextCursor: resp.nextCursor,
            total: resp.total,
            totalCapped: resp.totalCapped
          };
          writeLocalCache(CACHE_KEY, snapshot);
        }
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        lopuRef.current({ title: err?.error || 'Schema browsing hiccuped — try again 🌈', status: 'error' });
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [view]
  );

  // reconcile cached paint with fresh data
  React.useEffect(() => {
    runBrowse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setAndRun = (updates: { sort?: SortMode; scope?: ScopeMode }) => {
    if (updates.sort) setSort(updates.sort);
    if (updates.scope) setScope(updates.scope);
    runBrowse({ sortOverride: updates.sort, scopeOverride: updates.scope });
  };

  // builtin registry schemas (platform) — filtered client-side by q
  const builtinSources = React.useMemo(() => {
    if (scope !== 'all') return [];
    const needle = q.trim().toLowerCase();
    return crystalSchemas()
      .map(registryToCardSource)
      .filter((source) => !needle || source.name.toLowerCase().includes(needle) || source.description.toLowerCase().includes(needle));
  }, [scope, q]);

  const communitySources = React.useMemo(
    () => entries.map(entryToCardSource).filter(Boolean) as SchemaCardSource[],
    [entries]
  );
  const sources = React.useMemo(() => [...builtinSources, ...communitySources], [builtinSources, communitySources]);

  // ---- actions ------------------------------------------------------------

  const patchEntry = React.useCallback((id: string, patch: Partial<BrowseSchemaEntry> | ((entry: BrowseSchemaEntry) => BrowseSchemaEntry)) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? (typeof patch === 'function' ? patch(entry) : { ...entry, ...patch }) : entry))
    );
  }, []);

  const handleReact = React.useCallback(
    (source: SchemaCardSource, token: string) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to react to schemas ✨', status: 'info', duration: 6000 });
        return;
      }
      if (!source.entry) return;
      const had = source.entry.viewerReactions.includes(token);
      // optimistic flip, per-token reconcile when the server answers
      patchEntry(source.id, (entry) => ({
        ...entry,
        viewerReactions: had ? entry.viewerReactions.filter((t) => t !== token) : [...entry.viewerReactions, token],
        reactionCounts: {
          ...entry.reactionCounts,
          [token]: Math.max(0, (entry.reactionCounts[token] || 0) + (had ? -1 : 1))
        }
      }));
      apiRef.current.v1.things
        .react({ id: source.id, emoji: token })
        .then((resp: any) => {
          if (resp?.ok) {
            patchEntry(source.id, { reactionCounts: resp.reactionCounts, viewerReactions: resp.viewerReactions });
          }
        })
        .catch((err: any) => {
          patchEntry(source.id, (entry) => ({
            ...entry,
            viewerReactions: had ? [...entry.viewerReactions, token] : entry.viewerReactions.filter((t) => t !== token),
            reactionCounts: {
              ...entry.reactionCounts,
              [token]: Math.max(0, (entry.reactionCounts[token] || 0) + (had ? 1 : -1))
            }
          }));
          lopuRef.current({ title: err?.error || 'Reaction didn’t land — try again 🌈', status: 'error' });
        });
    },
    [user, patchEntry]
  );

  const handleSave = React.useCallback(
    (source: SchemaCardSource) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to build your schema library 📚', status: 'info', duration: 6000 });
        return;
      }
      if (!source.entry) return;
      const wasSaved = source.entry.saved;
      patchEntry(source.id, { saved: !wasSaved });
      apiRef.current.v1.things
        .save({ id: source.id })
        .then((resp: any) => {
          if (resp?.ok) {
            patchEntry(source.id, { saved: resp.saved });
            if (!resp.saved && stateRef.current.scope === 'library') {
              setEntries((prev) => prev.filter((entry) => entry.id !== source.id));
            }
          }
        })
        .catch((err: any) => {
          patchEntry(source.id, { saved: wasSaved });
          lopuRef.current({ title: err?.error || 'Save didn’t stick — try again 🌈', status: 'error' });
        });
    },
    [user, patchEntry]
  );

  const handleFork = React.useCallback(
    (source: SchemaCardSource) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to fork schemas 🍴', status: 'info', duration: 6000 });
        return;
      }
      setBuilderPrefill({
        name: `${source.name} fork`,
        description: source.description,
        fields: source.fields,
        forkOf: source.origin === 'community' ? source.id : undefined
      });
      setBuilderOpen(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [user]
  );

  const handleCreateThing = React.useCallback(
    (source: SchemaCardSource) => {
      if (!user) {
        lopuRef.current({ title: 'Sign in to create things ✨', status: 'info', duration: 6000 });
        return;
      }
      setCreateFor(source);
    },
    [user]
  );

  const handleSearchThings = React.useCallback(
    (source: SchemaCardSource) => {
      const param = source.origin === 'builtin' ? `builtin:${source.id}` : source.id;
      navigate(`/search?schema=${encodeURIComponent(param)}`);
    },
    [navigate]
  );

  const handleCreated = React.useCallback((thing: any) => {
    const entry: BrowseSchemaEntry = {
      ...thing,
      reactionCounts: {},
      viewerReactions: [],
      saved: false,
      usageCount: 0
    };
    setEntries((prev) => [entry, ...prev.filter((existing) => existing.id !== entry.id)]);
    setTotal((prev) => (typeof prev === 'number' ? prev + 1 : prev));
    setBuilderOpen(false);
    setBuilderPrefill(null);
  }, []);

  // ---- infinite scroll ----------------------------------------------------

  const loadMoreRef = React.useRef<() => void>(() => {});
  loadMoreRef.current = () => {
    if (stateRef.current.nextCursor && !stateRef.current.loading) {
      runBrowse({ cursor: stateRef.current.nextCursor });
    }
  };
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (observed) => {
        if (observed.some((observedEntry) => observedEntry.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // ---- render -------------------------------------------------------------

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    runBrowse();
  };

  const cardFor = (source: SchemaCardSource) => (
    <SchemaCard
      key={source.key}
      onCreateThing={handleCreateThing}
      onFork={handleFork}
      onReact={handleReact}
      onSave={handleSave}
      onSearchThings={handleSearchThings}
      source={source}
    />
  );

  const communityCount = total !== null ? `${total}${totalCapped ? '+' : ''}` : entries.length ? String(entries.length) : '…';

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex direction="column" gap={5} maxWidth={view === 'feed' ? '760px' : '1180px'} pb={24} pt="90px" px={4} width="100%">
        <Flex align="baseline" gap={3} wrap="wrap">
          <Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={800}>
            Schemas
          </Text>
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
            shapes for every thing — browse, fork, build your own
          </Text>
          <Box flex={1} />
          <Button
            as="a"
            color="var(--tt-muted, #9a9aa6)"
            fontSize="12px"
            href="/docs/schemas"
            size="xs"
            variant="ghost"
          >
            <BookOpen size={13} style={{ marginRight: 6 }} /> Reference docs
          </Button>
        </Flex>

        <form onSubmit={submit}>
          <Center height="56px" position="relative">
            <Rainbow opacity={0.6} position="absolute" repeats={2} thickness={10} />
            <Flex
              align="center"
              background="var(--tt-card, #ffffff)"
              borderRadius="full"
              gap={2}
              height="100%"
              paddingX={5}
              position="relative"
              width="100%"
            >
              <Search color="var(--tt-muted, #9a9aa6)" size={16} />
              <Input
                _placeholder={{ color: 'var(--tt-muted, #9a9aa6)' }}
                border="none"
                onChange={(event) => setQ(event.target.value)}
                outline="none"
                padding={0}
                placeholder="Search every schema…"
                value={q}
                variant="unstyled"
              />
              <Button colorScheme="pink" isLoading={loading && !entries.length} size="sm" type="submit">
                Search
              </Button>
            </Flex>
          </Center>
        </form>

        <Flex align="center" gap={2} wrap="wrap">
          <Text {...monoLabel}>view</Text>
          <Button {...pillProps(view === 'feed')} leftIcon={<Rows3 size={13} />} onClick={() => setView('feed')}>
            Feed
          </Button>
          <Button {...pillProps(view === 'grid')} leftIcon={<LayoutGrid size={13} />} onClick={() => setView('grid')}>
            Grid
          </Button>
          <Button {...pillProps(view === 'columns')} leftIcon={<Columns3 size={13} />} onClick={() => setView('columns')}>
            Columns
          </Button>
          <Box width={2} />
          <Text {...monoLabel}>sort</Text>
          <Button {...pillProps(sort === 'newest')} onClick={() => setAndRun({ sort: 'newest' })}>
            Newest
          </Button>
          <Button {...pillProps(sort === 'popular')} onClick={() => setAndRun({ sort: 'popular' })}>
            Popular
          </Button>
          <Button {...pillProps(sort === 'oldest')} onClick={() => setAndRun({ sort: 'oldest' })}>
            Oldest
          </Button>
          {user && (
            <>
              <Box width={2} />
              <Text {...monoLabel}>show</Text>
              <Button {...pillProps(scope === 'all')} onClick={() => setAndRun({ scope: 'all' })}>
                All
              </Button>
              <Button {...pillProps(scope === 'mine')} onClick={() => setAndRun({ scope: 'mine' })}>
                Mine
              </Button>
              <Button {...pillProps(scope === 'library')} leftIcon={<Library size={13} />} onClick={() => setAndRun({ scope: 'library' })}>
                Library
              </Button>
            </>
          )}
          <Box flex={1} />
          <Button
            colorScheme="pink"
            leftIcon={<Plus size={14} />}
            onClick={() => {
              setBuilderPrefill(null);
              setBuilderOpen((open) => !open);
            }}
            size="sm"
          >
            Create a Schema
          </Button>
        </Flex>

        {builderOpen && (
          <SchemaBuilder
            onClose={() => {
              setBuilderOpen(false);
              setBuilderPrefill(null);
            }}
            onCreated={handleCreated}
            prefill={builderPrefill}
          />
        )}

        <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
          {scope === 'all'
            ? `${builtinSources.length} platform · ${communityCount} community`
            : scope === 'mine'
              ? `${communityCount} of yours`
              : `${entries.length} in your library`}
        </Text>

        {view === 'feed' && <Flex direction="column" gap={3}>{sources.map(cardFor)}</Flex>}
        {view === 'grid' && (
          <Grid gap={3} templateColumns="repeat(auto-fill, minmax(310px, 1fr))">
            {sources.map(cardFor)}
          </Grid>
        )}
        {view === 'columns' && (
          <Box sx={{ columnCount: { base: 1, md: 2, xl: 3 }, columnGap: '12px', '& > *': { marginBottom: '12px' } }}>
            {sources.map(cardFor)}
          </Box>
        )}

        {!sources.length && !loading && (
          <Box
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            color="var(--tt-muted, #9a9aa6)"
            padding={10}
            textAlign="center"
          >
            {scope === 'library'
              ? 'Nothing saved yet — browse All and tap “Add to library” 📚'
              : scope === 'mine'
                ? 'You haven’t published a schema yet — Create a Schema above ✨'
                : 'No schemas match — try a different search 🌈'}
          </Box>
        )}

        <div ref={sentinelRef} />
        {nextCursor && (
          <Button alignSelf="center" isLoading={loading} onClick={() => loadMoreRef.current()} size="sm" variant="outline">
            Load more
          </Button>
        )}
      </Flex>

      {createFor && <SchemaThingForm onClose={() => setCreateFor(null)} source={createFor} />}
    </Flex>
  );
};
