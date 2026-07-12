import React from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Input,
  Select,
  Text
} from '@chakra-ui/react';
import { Plus, Search as SearchIcon, Sparkles } from 'lucide-react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router';

import { Rainbow } from '~/components/Rainbow/Rainbow';
import { useLopu } from '~/components/Lopu/useLopu';
import { useApi } from '~/hooks/useApi';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { thingtimeSchemas } from '~/schemas/registry';
import { CARD_STYLES } from '~/theme/card';
import {
  ConditionRowsEditor,
  ROOT_FIELD_SUGGESTIONS,
  compileRows,
  invalidNumberField,
  newRow
} from './searchBuilder';
import type {
  ConditionRow,
  SchemaSource,
  SearchPerson,
  SearchPost,
  SearchResponse,
  SearchThing
} from './searchTypes';

// The /search page — the Commander search bar, grown up. A ranked text search
// (Google-style) over every visible thing, plus a minimalist query builder
// that compiles GUI rows into the API's whitelisted MongoDB operator grammar,
// plus a schema browser that prefills the builder from a shape's fields.

const CACHE_KEY = 'tt-search';
const PAGE_SIZE = 20;

// A schema field definition → a prefilled (but empty) builder row.
const rowFromSchemaField = (field: SchemaSource['fields'][number]): ConditionRow => {
  const meta = {
    values: field.values,
    min: field.min,
    max: field.max,
    unit: field.unit,
    type: field.type,
    description: field.description
  };
  if (field.values?.length) {
    return newRow({ field: field.name, op: 'in', valueType: 'auto', meta });
  }
  if (field.type === 'number') {
    return newRow({ field: field.name, op: 'between', valueType: 'number', meta });
  }
  if (field.type === 'boolean') {
    return newRow({ field: field.name, op: 'eq', value: 'true', valueType: 'boolean', meta });
  }
  if (field.type === 'date') {
    // crystal dates are ISO strings — string comparison orders them correctly
    return newRow({ field: field.name, op: 'between', valueType: 'text', meta });
  }
  return newRow({ field: field.name, op: 'contains', meta });
};

// only fields the search grammar can actually address prefill a row — the
// data schema's illustrative '*' wildcard and object/record payload fields
// (e.g. a schema thing's own `fields` array) would just 400 on submit
const SEARCHABLE_FIELD_NAME = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const searchableField = (field: { name: string; type: string }) =>
  SEARCHABLE_FIELD_NAME.test(field.name) && field.type !== 'object' && field.type !== 'record';

const builtinSchemaSources = (): SchemaSource[] =>
  thingtimeSchemas
    .filter((schema) => schema.kind === 'crystal')
    .map((schema) => ({
      key: `builtin-${schema.id}`,
      name: schema.title,
      description: schema.summary,
      origin: 'builtin' as const,
      fields: schema.fields
        .filter((field) => searchableField(field))
        .map((field) => ({
          name: field.name,
          type: field.type === 'enum' ? 'enum' : field.type,
          description: field.description,
          values: field.values,
          max: undefined,
          min: undefined,
          unit: undefined
        }))
    }));

const schemaThingToSource = (thing: SearchThing): SchemaSource | null => {
  const crystal = thing.crystal || {};
  const fields = Array.isArray(crystal.fields) ? crystal.fields : [];
  if (typeof crystal.name !== 'string' || !fields.length) return null;
  return {
    key: `thing-${thing.id}`,
    name: crystal.name,
    description: typeof crystal.description === 'string' ? crystal.description : '',
    origin: 'community',
    author: thing.author?.username || null,
    fields: fields
      .filter((field: any) => field && typeof field.name === 'string' && field.name)
      .map((field: any) => ({
        name: field.name,
        type: typeof field.type === 'string' ? field.type : 'string',
        description: typeof field.description === 'string' ? field.description : undefined,
        values: Array.isArray(field.values) ? field.values.filter((v: any) => typeof v === 'string') : undefined,
        min: Number.isFinite(field.min) ? field.min : undefined,
        max: Number.isFinite(field.max) ? field.max : undefined,
        unit: typeof field.unit === 'string' ? field.unit : undefined
      }))
  };
};

type CachedSearch = {
  q: string;
  mode: 'all' | 'any';
  rows: ConditionRow[];
  kind: string;
  sort: string;
  things: SearchThing[];
  posts: Record<string, SearchPost>;
  people?: SearchPerson[];
  total: number | null;
  totalCapped: boolean;
  ranked: boolean;
  nextCursor: string | null;
};

function PersonCard({ person }: { person: SearchPerson }) {
  return (
    <Flex
      as={RouterLink}
      _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
      align="center"
      {...CARD_STYLES}
      gap={3}
      maxWidth="100%"
      px={3}
      py={2}
      to={`/profile/${encodeURIComponent(person.username)}`}
    >
      <Center
        background="var(--tt-surface-alt, #f5f5f7)"
        borderRadius="full"
        flexShrink={0}
        height="34px"
        overflow="hidden"
        width="34px"
      >
        {person.avatarUrl ? (
          <img alt="" src={person.avatarUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <Text fontSize="sm">{(person.displayName || person.username).slice(0, 1).toUpperCase()}</Text>
        )}
      </Center>
      <Box minWidth={0}>
        <Text color="var(--tt-text, #33333c)" fontSize="sm" fontWeight="600" isTruncated>
          {person.displayName || person.username}
          <Text as="span" color="var(--tt-muted, #9a9aa6)" fontWeight="400" ml={1.5}>
            @{person.username}
          </Text>
        </Text>
        {person.bio ? (
          <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" isTruncated>
            {person.bio}
          </Text>
        ) : null}
      </Box>
    </Flex>
  );
}

const previewValue = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function CrystalPreview({ crystal }: { crystal: Record<string, any> }) {
  const entries = Object.entries(crystal || {}).filter(([, value]) => value !== '' && value !== undefined);
  if (!entries.length) {
    return (
      <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="xs">
        no crystal fields
      </Text>
    );
  }
  return (
    <Flex gap={2} wrap="wrap">
      {entries.slice(0, 12).map(([key, value]) => (
        <Flex
          key={key}
          align="baseline"
          bg="var(--tt-surface-alt, #f5f5f7)"
          borderRadius="var(--tt-radius-xs, 7px)"
          fontFamily="mono"
          fontSize="12px"
          gap={1}
          maxWidth="100%"
          px={2}
          py={0.5}
        >
          <Text as="span" color="var(--tt-muted, #9a9aa6)" flexShrink={0}>
            {key}:
          </Text>
          <Text as="span" color="var(--tt-text, #5a5a66)" isTruncated maxWidth="360px">
            {previewValue(value).slice(0, 160)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

// memoized — result cards are stable between builder-row keystrokes, and
// CrystalPreview stringifies every chip on render
const ThingResultCard = React.memo(function ThingResultCard({
  thing,
  post
}: {
  thing: SearchThing;
  post: SearchPost | null;
}) {
  const created = new Date(thing.createdAt);
  const when = Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString();
  const title = post?.text || thing.crystal?.name || thing.crystal?.title || thing.crystal?.text || '';

  return (
    <Box {...CARD_STYLES} p={4}>
      <Flex align="center" gap={2} mb={title ? 2 : 0} wrap="wrap">
        {thing.thingtime.map((id) => (
          <Badge key={id} colorScheme="purple" fontFamily="mono" textTransform="none">
            {id}
          </Badge>
        ))}
        {thing.tags.map((tag) => (
          <Badge key={tag} colorScheme="gray" fontFamily="mono" textTransform="none">
            #{tag}
          </Badge>
        ))}
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" marginLeft="auto">
          {thing.author ? `@${thing.author.username}` : 'unknown'} · {when}
        </Text>
      </Flex>
      {title ? (
        <Text color="var(--tt-text, #33333c)" fontSize="md" mb={2} whiteSpace="pre-wrap">
          {String(title).slice(0, 400)}
        </Text>
      ) : null}
      <CrystalPreview crystal={thing.crystal} />
      {post ? (
        <Flex color="var(--tt-muted, #9a9aa6)" fontSize="xs" gap={3} mt={2}>
          <Text>{Object.values(post.reactionCounts || {}).reduce((sum, count) => sum + count, 0)} reactions</Text>
          <Text>{post.commentCount} comments</Text>
          <Text>{post.shareCount} shares</Text>
        </Flex>
      ) : null}
    </Box>
  );
});

export const SearchPage = () => {
  const api = useApi();
  const lopu = useLopu();
  const location = useLocation();
  const navigate = useNavigate();

  const cached = React.useMemo(() => readLocalCache<CachedSearch>(CACHE_KEY), []);
  const urlQ = React.useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  // a NEW ?q= (e.g. the Commander's "Search things for…" row) means a fresh
  // text search — don't drag the previous session's filters into it
  const freshFromUrl = !!urlQ && urlQ !== (cached?.q || '');

  const [q, setQ] = React.useState(urlQ || cached?.q || '');
  const [mode, setMode] = React.useState<'all' | 'any'>(freshFromUrl ? 'all' : cached?.mode || 'all');
  const [rows, setRows] = React.useState<ConditionRow[]>(!freshFromUrl && cached?.rows?.length ? cached.rows : []);
  const [kind, setKind] = React.useState(freshFromUrl ? '' : cached?.kind || '');
  const [sort, setSort] = React.useState(freshFromUrl ? 'auto' : cached?.sort || 'auto');

  // optimistic first paint: last-known results render instantly from
  // localStorage, the fresh search reconciles in the background
  const [things, setThings] = React.useState<SearchThing[]>(cached?.things || []);
  const [posts, setPosts] = React.useState<Record<string, SearchPost>>(cached?.posts || {});
  const [people, setPeople] = React.useState<SearchPerson[]>(cached?.people || []);
  const [total, setTotal] = React.useState<number | null>(cached?.total ?? null);
  const [totalCapped, setTotalCapped] = React.useState(cached?.totalCapped || false);
  const [ranked, setRanked] = React.useState(cached?.ranked || false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(cached?.nextCursor ?? null);
  const [loading, setLoading] = React.useState(false);

  const [schemasOpen, setSchemasOpen] = React.useState(false);
  const [communitySchemas, setCommunitySchemas] = React.useState<SchemaSource[]>([]);
  const [activeSchema, setActiveSchema] = React.useState<string | null>(null);

  const requestSeqRef = React.useRef(0);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const stateRef = React.useRef({ q, mode, rows, kind, sort });
  stateRef.current = { q, mode, rows, kind, sort };
  // the query that produced the current result set — load-more continues THIS
  // query, never live (possibly edited-but-unsubmitted) builder state, so a
  // stale cursor can't be mixed with new params
  const submittedRef = React.useRef(stateRef.current);

  const runSearch = React.useCallback(
    async (options: { cursor?: string | null } = {}) => {
      const { cursor } = options;
      const seq = ++requestSeqRef.current;
      setLoading(true);

      const current = cursor ? submittedRef.current : stateRef.current;
      if (!cursor) submittedRef.current = current;

      const invalidField = invalidNumberField(current.rows);
      if (invalidField) {
        setLoading(false);
        lopuRef.current({
          title: `"${invalidField}" wants a number`,
          description: 'That value isn’t numeric — fix it or switch the row’s datatype to text.',
          status: 'error'
        });
        return;
      }

      const conditions = compileRows(current.rows);
      const body: Record<string, unknown> = {
        q: current.q.trim() || undefined,
        mode: current.mode,
        conditions: conditions || undefined,
        thingtime: current.kind || undefined,
        sort: current.sort === 'auto' ? undefined : current.sort,
        cursor: cursor || undefined,
        limit: PAGE_SIZE
      };

      try {
        // people ride along on first-page text searches — users aren't things
        // (separate collection), so they get their own endpoint, in parallel
        const wantPeople = !cursor && !!current.q.trim();
        const [resp, peopleResp] = (await Promise.all([
          apiRef.current.v1.things.search(body),
          wantPeople
            ? apiRef.current.v1.profile.search({ q: current.q.trim(), limit: 8 }).catch(() => null)
            : Promise.resolve(null)
        ])) as [SearchResponse, { users?: SearchPerson[] } | null];
        if (seq !== requestSeqRef.current) return;

        if (!cursor) setPeople(wantPeople ? peopleResp?.users || [] : []);

        setThings((prev) => {
          if (!cursor) return resp.things || [];
          const seen = new Set(prev.map((thing) => thing.id));
          return [...prev, ...(resp.things || []).filter((thing) => !seen.has(thing.id))];
        });
        setPosts((prev) => (cursor ? { ...prev, ...(resp.posts || {}) } : resp.posts || {}));
        setNextCursor(resp.nextCursor ?? null);
        // load-more responses skip the count — keep the first page's total
        if (!cursor || resp.total !== null) {
          setTotal(resp.total ?? null);
          setTotalCapped(!!resp.totalCapped);
        }
        setRanked(!!resp.ranked);

        if (!cursor) {
          const snapshot: CachedSearch = {
            q: current.q,
            mode: current.mode,
            rows: current.rows,
            kind: current.kind,
            sort: current.sort,
            things: (resp.things || []).slice(0, PAGE_SIZE),
            posts: resp.posts || {},
            people: wantPeople ? peopleResp?.users || [] : [],
            total: resp.total ?? null,
            totalCapped: !!resp.totalCapped,
            ranked: !!resp.ranked,
            nextCursor: resp.nextCursor ?? null
          };
          writeLocalCache(CACHE_KEY, snapshot);

          // keep the URL shareable for plain text searches
          const params = new URLSearchParams();
          if (current.q.trim()) params.set('q', current.q.trim());
          navigate({ pathname: '/search', search: params.toString() ? `?${params}` : '' }, { replace: true });
        }
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        lopuRef.current({ title: err?.error || 'Search hit a snag 😞', status: 'error' });
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [navigate]
  );

  // first mount: refetch whatever the page painted from cache (or run the
  // URL's ?q= / an empty browse-recent search) — optimistic render, live data
  React.useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a ?q= arriving while the page is already mounted (Commander's pinned row
  // used on /search itself) is a fresh text search — reset filters and rerun.
  // Initializers only cover the mount case; this covers every later one.
  const lastUrlQRef = React.useRef(urlQ);
  const [pendingUrlSearch, setPendingUrlSearch] = React.useState(false);
  React.useEffect(() => {
    if (urlQ === lastUrlQRef.current) return;
    lastUrlQRef.current = urlQ;
    if (!urlQ) return;
    // runSearch syncs ?q= after every submit — our own echo is not a new search
    if (urlQ === stateRef.current.q.trim()) return;
    setQ(urlQ);
    setRows([]);
    setKind('');
    setSort('auto');
    setMode('all');
    setActiveSchema(null);
    setPendingUrlSearch(true);
  }, [urlQ]);
  React.useEffect(() => {
    if (!pendingUrlSearch) return;
    setPendingUrlSearch(false);
    // runs after the resets above have re-rendered, so stateRef is fresh
    runSearch();
  }, [pendingUrlSearch, runSearch]);

  // community schemas load lazily when the browser opens
  React.useEffect(() => {
    if (!schemasOpen || communitySchemas.length) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = (await apiRef.current.v1.things.search({
          thingtime: 'schema',
          sort: 'newest',
          limit: 50
        })) as SearchResponse;
        if (cancelled) return;
        setCommunitySchemas(
          (resp.things || [])
            .map(schemaThingToSource)
            .filter((source): source is SchemaSource => !!source)
        );
      } catch {
        // schema browsing is sugar — the builder still works without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schemasOpen, communitySchemas.length]);

  const schemaSources = React.useMemo(
    () => [...communitySchemas, ...builtinSchemaSources()],
    [communitySchemas]
  );

  const applySchema = React.useCallback((source: SchemaSource) => {
    setActiveSchema(source.key);
    const prefilled = source.fields.map((field) => rowFromSchemaField(field));
    // community data things carry `schema: "<Name>"` by convention — pin that
    // condition first so the prefilled search actually scopes to the shape
    if (source.origin === 'community') {
      prefilled.unshift(newRow({ field: 'schema', op: 'eq', value: source.name, valueType: 'text' }));
    }
    setRows(prefilled);
    setMode('all');
  }, []);

  const updateRow = React.useCallback((id: string, patch: Partial<ConditionRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = React.useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const fieldSuggestions = React.useMemo(() => {
    const fromSchema = activeSchema
      ? schemaSources.find((source) => source.key === activeSchema)?.fields.map((field) => field.name) || []
      : [];
    return [...new Set([...fromSchema, ...ROOT_FIELD_SUGGESTIONS])];
  }, [activeSchema, schemaSources]);

  const submit = React.useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      runSearch();
    },
    [runSearch]
  );

  // the count is a visibility-superset approximation (private-to-others docs
  // can be counted but never shown), so present it as such
  const totalLabel =
    total === null ? null : `${totalCapped ? `${total}+` : `~${total}`} thing${total === 1 && !totalCapped ? '' : 's'}`;

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex direction="column" gap={5} maxWidth="760px" pb={24} pt="90px" px={4} width="100%">
        {/* Commander, grown up: the same rainbow-ringed input, page-sized */}
        <form onSubmit={submit}>
          <Center position="relative" width="100%">
            <Center
              borderRadius="var(--tt-radius-sm, 9px)"
              height="56px"
              overflow="hidden"
              padding="2px"
              position="relative"
              width="100%"
            >
              <Rainbow opacity={0.6} position="absolute" repeats={2} thickness={10} />
              <Flex
                align="center"
                background="var(--tt-card, #ffffff)"
                borderRadius="var(--tt-radius-xs, 7px)"
                gap={2}
                height="100%"
                position="relative"
                px={3}
                width="100%"
                zIndex={1}
              >
                <SearchIcon color="var(--tt-muted, #9a9aa6)" size={18} />
                <Input
                  _placeholder={{ color: 'var(--tt-muted, #9a9aa6)' }}
                  border="none"
                  fontSize="md"
                  height="100%"
                  onChange={(event) => setQ(event.target.value)}
                  outline="none"
                  padding={0}
                  placeholder="Search every thing…"
                  value={q}
                  variant="unstyled"
                />
                <Button colorScheme="pink" isLoading={loading} size="sm" type="submit" variant="solid">
                  Search
                </Button>
              </Flex>
            </Center>
          </Center>
        </form>

        {/* builder controls */}
        <Flex align="center" gap={2} wrap="wrap">
          <Button
            leftIcon={<Plus size={14} />}
            onClick={() => setRows((prev) => [...prev, newRow()])}
            size="xs"
            variant="outline"
          >
            Add filter
          </Button>
          <Button
            leftIcon={<Sparkles size={14} />}
            onClick={() => setSchemasOpen((prev) => !prev)}
            size="xs"
            variant={schemasOpen ? 'solid' : 'outline'}
          >
            Search by schema
          </Button>
          {rows.length > 1 ? (
            <Select
              maxWidth="150px"
              onChange={(event) => setMode(event.target.value === 'any' ? 'any' : 'all')}
              size="xs"
              value={mode}
            >
              <option value="all">match all filters</option>
              <option value="any">match any filter</option>
            </Select>
          ) : null}
          <Select maxWidth="140px" onChange={(event) => setKind(event.target.value)} size="xs" value={kind}>
            <option value="">any kind</option>
            <option value="post">posts</option>
            <option value="data">data</option>
            <option value="schema">schemas</option>
            <option value="comment">comments</option>
            <option value="reaction">reactions</option>
          </Select>
          <Select maxWidth="130px" onChange={(event) => setSort(event.target.value)} size="xs" value={sort}>
            <option value="auto">auto sort</option>
            <option value="relevance">relevance</option>
            <option value="newest">newest</option>
            <option value="oldest">oldest</option>
          </Select>
          {rows.length ? (
            <Button
              onClick={() => {
                setRows([]);
                setActiveSchema(null);
              }}
              size="xs"
              variant="ghost"
            >
              Clear filters
            </Button>
          ) : null}
        </Flex>

        {/* schema browser */}
        {schemasOpen ? (
          <Box {...CARD_STYLES} p={4}>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700" mb={3}>
              Pick a shape to search by — its fields prefill the builder
            </Text>
            <Flex gap={2} wrap="wrap">
              {schemaSources.map((source) => (
                <Button
                  key={source.key}
                  colorScheme={activeSchema === source.key ? 'pink' : undefined}
                  onClick={() => applySchema(source)}
                  size="sm"
                  title={source.description}
                  variant={activeSchema === source.key ? 'solid' : 'outline'}
                >
                  {source.name}
                  {source.origin === 'community' ? (
                    <Text as="span" color="var(--tt-muted, #9a9aa6)" fontSize="10px" ml={1.5}>
                      {source.author ? `@${source.author}` : 'community'}
                    </Text>
                  ) : null}
                </Button>
              ))}
              {!schemaSources.length ? (
                <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                  No schemas yet.
                </Text>
              ) : null}
            </Flex>
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" mt={3}>
              Anyone can publish a schema: POST /api/v1/things with thingtime ["schema"] — see /schemas.
            </Text>
          </Box>
        ) : null}

        {/* builder rows */}
        <ConditionRowsEditor
          rows={rows}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          fieldSuggestions={fieldSuggestions}
          datalistId="tt-search-fields"
        />

        {/* results */}
        <Flex align="baseline" gap={2}>
          {totalLabel ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
              {totalLabel}
              {ranked ? ' · best match first' : sort === 'oldest' ? ' · oldest first' : ' · newest first'}
            </Text>
          ) : null}
        </Flex>

        {people.length ? (
          <Flex direction="column" gap={2}>
            <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700">
              People
            </Text>
            <Flex direction="column" gap={2}>
              {people.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </Flex>
          </Flex>
        ) : null}

        <Flex direction="column" gap={3}>
          {things.map((thing) => (
            <ThingResultCard key={thing.id} post={posts[thing.id] || null} thing={thing} />
          ))}
          {!things.length && !people.length && !loading ? (
            <Box {...CARD_STYLES} p={8} textAlign="center">
              <Text color="var(--tt-muted, #9a9aa6)">
                Nothing matched — loosen a filter, or try plain words up top ✨
              </Text>
            </Box>
          ) : null}
        </Flex>

        {nextCursor ? (
          <Center>
            <Button isLoading={loading} onClick={() => runSearch({ cursor: nextCursor })} size="sm" variant="outline">
              Load more
            </Button>
          </Center>
        ) : null}
      </Flex>
    </Flex>
  );
};
