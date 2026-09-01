import React from 'react';
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  IconButton,
  Input,
  Select,
  Text
} from '@chakra-ui/react';
import { Braces, ExternalLink, Eye, Plus, Search as SearchIcon, Sparkles, X } from 'lucide-react';
import { Link as RouterLink, useLocation, useNavigate, useNavigation } from 'react-router';

import { canonicalPostTags } from '~/components/Attachments/attachmentUiCore';
import { blocksToText, getEditorJsDoc } from '~/components/Editor/editorJsValue';
import { PostCard } from '~/components/Feed/PostCard';
import type { PostChange } from '~/components/Feed/feedTypes';
import { searchTagHref } from '~/components/Feed/hashtags';
import { Rainbow } from '~/components/Rainbow/Rainbow';
import { ThingView } from '~/components/Thingtime/ThingView';
import { useLopu } from '~/components/Lopu/useLopu';
import {
  SEARCHABLE_CRYSTAL_KINDS,
  entryToSearchSource,
  registryToCardSource,
  toSearchSource
} from '~/components/Schemas/schemaBrowseTypes';
import { useApi } from '~/hooks/useApi';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { thingtimeSchemas } from '~/schemas/registry';
import { CARD_STYLES } from '~/theme/card';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';
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
import { thingDetailPath } from './commanderSearch';

// The /search page — the Commander search bar, grown up. A ranked text search
// (Google-style) over every visible thing, plus a minimalist query builder
// that compiles GUI rows into the API's whitelisted MongoDB operator grammar,
// plus a schema browser that prefills the builder from a shape's fields.

// Search snapshots can contain the viewer's OWN private things (visibilityQueryFor
// adds an ownerId clause), so the cache is scoped per user id — never a shared
// global key — and the pre-scoping global blob is purged on mount. Mirrors the
// per-user convention of tt-two-factor-${id} / useRecentReactions keyFor(userId).
const LEGACY_CACHE_KEY = 'tt-search';
const cacheKeyFor = (userId: string | null | undefined) => (userId ? `tt-search-${userId}` : null);
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

// display labels for the kind <Select>, rendered from SEARCHABLE_CRYSTAL_KINDS
// so the dropdown, the builtin schema chips, and /schemas' "Search things"
// gating can never drift apart
const KIND_OPTION_LABELS: Record<string, string> = {
  post: 'posts',
  data: 'data',
  schema: 'schemas',
  comment: 'comments',
  reaction: 'reactions',
  attachment: 'attachments'
};

// builtin crystal schemas the query builder can scope to → SchemaSource, via
// the shared registry→card→search converters (schemaBrowseTypes). One mapper
// (toSearchSource) shapes both builtin and community shapes, so their field
// metadata — and the seeded-builtin dedup — can never drift between /search
// and /schemas.
const builtinSearchSources = (): SchemaSource[] =>
  thingtimeSchemas
    .filter((schema) => schema.kind === 'crystal' && SEARCHABLE_CRYSTAL_KINDS.has(schema.id))
    .map(registryToCardSource)
    .map(toSearchSource)
    .filter((source): source is SchemaSource => !!source);

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
          <Text fontSize="sm">{getUserDisplayName(person).slice(0, 1).toUpperCase()}</Text>
        )}
      </Center>
      <Box minWidth={0}>
        <Text color="var(--tt-text, #33333c)" fontSize="sm" fontWeight="600" isTruncated>
          {getUserDisplayName(person)}
          <Text as="span" color="var(--tt-muted, #9a9aa6)" fontWeight="400" ml={1.5}>
            {getUserIdentityDetail(person)}
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

// Editor.js docs (rich-text) preview as their plain text, not raw block JSON,
// via the canonical blocksToText serializer. Returns null when the value isn't
// a rich-text doc OR is one with no extractable text (e.g. { blocks: [] } or
// non-Editor.js data that merely carries a `blocks` array) so the caller falls
// back to the JSON preview rather than masking real data with a placeholder.
const richTextPreview = (value: unknown): string | null => {
  const doc = getEditorJsDoc(value);
  if (!doc) return null;
  const text = blocksToText(doc.blocks).replace(/\s+/g, ' ').trim();
  return text || null;
};

const previewValue = (value: unknown): string => {
  if (value === null) return 'null';
  const richText = richTextPreview(value);
  if (richText) return richText;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function RankedMatchScore({ score }: { score?: number }) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const display = score.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  const label = `Ranked match score: ${display}`;
  return (
    <Text
      aria-label={label}
      color="var(--tt-muted, #9a9aa6)"
      fontFamily="mono"
      fontSize="10px"
      fontWeight="500"
      letterSpacing="0.02em"
      opacity={0.72}
      title={label}
      whiteSpace="nowrap"
    >
      ranked match · {display}
    </Text>
  );
}

function CrystalPreview({ crystal }: { crystal: Record<string, any> }) {
  // schemaId is internal provenance (the schema thing's shareId) — the
  // human-readable `schema` chip already conveys the shape
  const entries = Object.entries(crystal || {}).filter(
    ([key, value]) => key !== 'schemaId' && value !== '' && value !== undefined
  );
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
  // crystal name/title/text fields can hold an Editor.js doc — previewValue
  // surfaces its plain text (and falls back to JSON for other non-string
  // values, e.g. a numeric name, so they still show instead of vanishing).
  const titleSource = post?.text || thing.crystal?.name || thing.crystal?.title || thing.crystal?.text || '';
  const title = typeof titleSource === 'string' ? titleSource : titleSource ? previewValue(titleSource) : '';

  return (
    <Box {...CARD_STYLES} p={4}>
      <Flex align="center" gap={2} mb={title ? 2 : 0} wrap="wrap">
        {thing.thingtime.map((id) => (
          <Badge key={id} colorScheme="purple" fontFamily="mono" textTransform="none">
            {id}
          </Badge>
        ))}
        {thing.tags.map((tag) => (
          <Badge
            key={tag}
            as={RouterLink}
            _hover={{ textDecoration: 'underline' }}
            colorScheme="gray"
            fontFamily="mono"
            textTransform="none"
            to={searchTagHref(tag)}
          >
            #{tag}
          </Badge>
        ))}
        <Flex
          align="center"
          gap={2}
          marginLeft={{ base: 0, sm: 'auto' }}
          width={{ base: '100%', sm: 'auto' }}
          wrap={{ base: 'wrap', sm: 'nowrap' }}
        >
          <Flex align="center" gap={2} justify="space-between" width={{ base: '100%', sm: 'auto' }}>
            <RankedMatchScore score={thing.rankScore} />
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" marginLeft="auto" whiteSpace="nowrap">
              {thing.author ? getUserIdentityDetail(thing.author) : 'unknown'} · {when}
            </Text>
          </Flex>
          <Flex
            as={RouterLink}
            align="center"
            aria-label={`Open ${title || thing.thingtime[0] || 'thing'}`}
            color="var(--tt-text, #5a5a66)"
            fontSize="xs"
            gap={1}
            marginLeft={{ base: 'auto', sm: 0 }}
            textDecoration="underline"
            to={thingDetailPath(thing.id)}
          >
            Open thing
            <ExternalLink size={11} />
          </Flex>
        </Flex>
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

const StandardThingResult = React.memo(function StandardThingResult({
  thing,
  post,
  onPostChanged
}: {
  thing: SearchThing;
  post: SearchPost | null;
  onPostChanged: (id: string, change: PostChange) => void;
}) {
  // PostCard hands the post id back to `onChanged`, so the parent's
  // useCallback-stable handler passes straight through — a per-card wrapper
  // here would defeat PostCard's React.memo exactly like PostList's used to.

  if (post) {
    return (
      <Box>
        {typeof thing.rankScore === 'number' ? (
          <Flex justify="flex-end" mb={1} px={1}>
            <RankedMatchScore score={thing.rankScore} />
          </Flex>
        ) : null}
        <PostCard post={post} onChanged={onPostChanged} />
      </Box>
    );
  }

  const created = new Date(thing.createdAt);
  const when = Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString();
  const label =
    (typeof thing.crystal?.name === 'string' && thing.crystal.name) ||
    (typeof thing.crystal?.title === 'string' && thing.crystal.title) ||
    thing.thingtime[0] ||
    'Thing';

  return (
    <Box {...CARD_STYLES} p={4}>
      <Flex align="center" gap={2} mb={3} wrap="wrap">
        {thing.thingtime.map((id) => (
          <Badge key={id} colorScheme="purple" fontFamily="mono" textTransform="none">
            {id}
          </Badge>
        ))}
        <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" marginLeft="auto">
          {thing.author ? getUserIdentityDetail(thing.author) : 'unknown'} · {when}
        </Text>
        <RankedMatchScore score={thing.rankScore} />
        <Flex
          as={RouterLink}
          align="center"
          aria-label={`Open ${label}`}
          color="var(--tt-text, #5a5a66)"
          fontSize="xs"
          gap={1}
          textDecoration="underline"
          to={thingDetailPath(thing.id)}
        >
          Open thing
          <ExternalLink size={11} />
        </Flex>
      </Flex>
      <ThingView label={label} thing={thing.crystal} />
    </Box>
  );
});

export const SearchPage = () => {
  const api = useApi();
  const lopu = useLopu();
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const user = useCurrentUser();

  const cacheKey = cacheKeyFor(user?.id);
  // Purge any pre-scoping global 'tt-search' blob (it may hold another account's
  // private results) once, so it can never paint for the wrong principal.
  React.useEffect(() => {
    clearLocalCache(LEGACY_CACHE_KEY);
  }, []);
  const cached = React.useMemo(
    () => (cacheKey ? readLocalCache<CachedSearch>(cacheKey) : null),
    [cacheKey]
  );
  const urlQ = React.useMemo(() => new URLSearchParams(location.search).get('q') || '', [location.search]);
  // a NEW ?q= (e.g. the Commander's "Search things for…" row) means a fresh
  // text search — don't drag the previous session's filters into it
  const freshFromUrl = !!urlQ && urlQ !== (cached?.q || '');

  const [q, setQ] = React.useState(urlQ || cached?.q || '');
  const [mode, setMode] = React.useState<'all' | 'any'>(freshFromUrl ? 'all' : cached?.mode || 'all');
  const [rows, setRows] = React.useState<ConditionRow[]>(!freshFromUrl && cached?.rows?.length ? cached.rows : []);
  const [kind, setKind] = React.useState(freshFromUrl ? '' : cached?.kind || '');
  const [sort, setSort] = React.useState(freshFromUrl ? 'auto' : cached?.sort || 'auto');
  const [presentation, setPresentation] = React.useState<'standard' | 'data'>('standard');

  // optimistic first paint: last-known results render instantly from
  // localStorage and simply stay — nothing refetches until the user (or a
  // ?q=/?schema deep link) runs a search
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
  // the id of the shape-scope row applySchema pins for community schemas —
  // only THAT row renders as the locked chip (a hand-typed `schema eq X`
  // row stays an ordinary editable row)
  const [pinnedRowId, setPinnedRowId] = React.useState<string | null>(null);
  // schema rail browsing — same paginated system as /schemas (top/recent/popular)
  const [schemaQ, setSchemaQ] = React.useState('');
  const [schemaSort, setSchemaSort] = React.useState<'newest' | 'popular'>('newest');
  const [schemaCursor, setSchemaCursor] = React.useState<string | null>(null);
  const [schemasLoading, setSchemasLoading] = React.useState(false);
  const schemasLoadedRef = React.useRef(false);

  // false once the user leaves /search — an in-flight search resolving after
  // navigation must never replace-navigate them back here
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // render-synced mirrors of the router position: the resolve-time ?q= sync
  // must only fire while the user is still exactly where they submitted —
  // same history entry, no navigation pending. The data router keeps this
  // page mounted while the NEXT route's loaders run, so mountedRef alone
  // can't see an in-progress departure; Back within /search never unmounts.
  const locationKeyRef = React.useRef(location.key);
  locationKeyRef.current = location.key;
  const navigationIdleRef = React.useRef(true);
  navigationIdleRef.current = navigation.state === 'idle';
  // the last ?q= runSearch itself pushed into the URL — the urlQ effect uses
  // it to tell our own echo from an external navigation (comparing against
  // live input state breaks when the input was cache-restored, never searched)
  const lastSyncedQRef = React.useRef<string | null>(null);

  // whether the result area reflects an actual search — cached results are
  // one, and a ?q= deep link is about to run one. Gates the "Nothing matched"
  // empty state, which would otherwise show on a fresh visit where no search
  // has been fired yet
  const [hasSearched, setHasSearched] = React.useState(!!cached || !!urlQ);

  const requestSeqRef = React.useRef(0);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  // always-current viewer id so the search body can flag logged-out queries as
  // edge-cacheable (`anon=1` → GET form) without stale-closure risk
  const viewerIdRef = React.useRef(user?.id ?? null);
  viewerIdRef.current = user?.id ?? null;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const stateRef = React.useRef({ q, mode, rows, kind, sort });
  stateRef.current = { q, mode, rows, kind, sort };
  // the query that produced the current result set — load-more continues THIS
  // query, never live (possibly edited-but-unsubmitted) builder state, so a
  // stale cursor can't be mixed with new params
  const submittedRef = React.useRef(stateRef.current);

  // the ?tags deep-link key the tags effect below last applied — declared here
  // (above runSearch) because a FAILED search must reset it: the success-path
  // URL sync never ran, so ?tags would otherwise stay in the URL with the
  // guard still set, making a re-tap of the same chip a byte-identical
  // navigation that silently no-ops instead of retrying
  const appliedUrlTagsRef = React.useRef<string | null>(null);

  const runSearch = React.useCallback(
    async (options: { cursor?: string | null } = {}) => {
      const { cursor } = options;
      const seq = ++requestSeqRef.current;
      // where the user was when they asked — the resolve-time URL sync must
      // never fire from anywhere else
      const submittedLocationKey = locationKeyRef.current;
      setLoading(true);

      const current = cursor ? submittedRef.current : stateRef.current;

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
      // relevance needs a text query — the server 400s otherwise, so drop it to
      // server-pick (auto) when q is empty, matching the feed Advanced panel
      const effectiveSort =
        current.sort === 'auto' || (current.sort === 'relevance' && !current.q.trim())
          ? undefined
          : current.sort;
      const body: Record<string, unknown> = {
        q: current.q.trim() || undefined,
        mode: current.mode,
        conditions: conditions || undefined,
        thingtime: current.kind || undefined,
        sort: effectiveSort,
        cursor: cursor || undefined,
        limit: PAGE_SIZE,
        anon: viewerIdRef.current ? undefined : 1
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
        setHasSearched(true);
        // only a RESOLVED first page owns load-more continuation — committing
        // submittedRef at submit time would let a failed search's params be
        // mixed with the painted result set's cursor by a later Load more
        if (!cursor) submittedRef.current = current;

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
          if (cacheKey) writeLocalCache(cacheKey, snapshot);

          // keep the URL shareable for plain text searches — but only while
          // the user is still HERE: still mounted, same history entry as when
          // they submitted, and no navigation in flight. A replace-navigate
          // fired outside those bounds yanks the user back to /search, aborts
          // a pending departure (data routers keep us mounted while the next
          // route's loaders run), or silently undoes a Back within /search.
          if (
            mountedRef.current &&
            navigationIdleRef.current &&
            locationKeyRef.current === submittedLocationKey
          ) {
            const params = new URLSearchParams();
            if (current.q.trim()) params.set('q', current.q.trim());
            lastSyncedQRef.current = current.q.trim();
            navigate({ pathname: '/search', search: params.toString() ? `?${params}` : '' }, { replace: true });
          }
        }
      } catch (err: any) {
        if (seq !== requestSeqRef.current) return;
        // a failed ?tags deep-link search must not strand the param: reset the
        // applied guard and strip the dead ?tags (mirrors the ?schema failure
        // path) so revisiting the same chip link retries instead of no-opping.
        // The guard is only ever set while a seeded search hasn't succeeded
        // yet — success strips ?tags, which resets it via the tags effect.
        if (appliedUrlTagsRef.current !== null) {
          appliedUrlTagsRef.current = null;
          // same still-here bounds as the success sync — never yank the user
          // back to /search from a departure or a different history entry
          if (
            mountedRef.current &&
            navigationIdleRef.current &&
            locationKeyRef.current === submittedLocationKey
          ) {
            const params = new URLSearchParams(window.location.search);
            if (params.has('tags')) {
              params.delete('tags');
              navigate({ pathname: '/search', search: params.toString() ? `?${params}` : '' }, { replace: true });
            }
          }
        }
        lopuRef.current({ title: err?.error || 'Search hit a snag 😞', status: 'error' });
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    },
    [navigate]
  );

  // first mount: only an EXPLICIT deep link searches automatically. A ?q=
  // (Commander's "Search things for…") runs that text search; a ?schema deep
  // link's search is owned by the schema effect instead (running both races
  // them, and the winner's replace-navigate strips ?schema out from under the
  // loser's cancellable resolution). A plain /search visit fires nothing —
  // cached results still paint instantly, but no search runs until the user
  // asks for one.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('schema')) return;
    // a ?tags deep link's search is owned by the tags effect below (same
    // reasoning as ?schema: running both would race them)
    if (params.get('tags')) return;
    if (!params.get('q')) return;
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
    // runSearch syncs ?q= after every submit — our own echo is not a new
    // search. Compare against the q the sync actually pushed, NOT live input
    // state: a cache-restored, never-searched input matching the URL must
    // still search (e.g. Commander re-running yesterday's query)
    if (urlQ === lastSyncedQRef.current) return;
    // the URL provably moved off the q we synced (e.g. Back stripped it) — a
    // future identical ?q= is a real navigation, not our echo. Must clear
    // BEFORE the empty-q return below, which is exactly the Back case.
    lastSyncedQRef.current = null;
    if (!urlQ) return;
    setQ(urlQ);
    setRows([]);
    setKind('');
    setSort('auto');
    setMode('all');
    setActiveSchema(null);
    setPinnedRowId(null);
    setPendingUrlSearch(true);
  }, [urlQ]);
  React.useEffect(() => {
    if (!pendingUrlSearch) return;
    setPendingUrlSearch(false);
    // runs after the resets above have re-rendered, so stateRef is fresh
    runSearch();
  }, [pendingUrlSearch, runSearch]);

  // Tag chips on posts (and inline #hashtag links) deep-link here with
  // ?tags=<tag>[&tags=<tag>…] — one tag per repeated param, read via getAll
  // with NO delimiter, so a stored tag containing a comma (the server permits
  // them) seeds ONE row that matches the post instead of splitting into rows
  // that match nothing. Seed the builder with visible `tags is <tag>` rows —
  // editable and removable like any hand-made row — and run the scoped search
  // (each `tags eq` condition matches array membership server-side, so mode
  // 'all' means "has every listed tag"). The post-search URL sync then strips
  // ?tags — the same consume-then-clean flow as ?schema — and the emptied
  // param resets the guard so tapping the same chip again still re-runs.
  const urlTags = React.useMemo(
    () => canonicalPostTags(new URLSearchParams(location.search).getAll('tags')),
    [location.search]
  );
  React.useEffect(() => {
    // JSON keeps the guard key unambiguous even for tags that themselves
    // contain a comma (join would collide ["a,b"] with ["a","b"])
    const key = urlTags.length ? JSON.stringify(urlTags) : '';
    if (!key) {
      appliedUrlTagsRef.current = null;
      return;
    }
    if (appliedUrlTagsRef.current === key) return;
    appliedUrlTagsRef.current = key;
    setQ('');
    setRows(urlTags.map((tag) => newRow({ field: 'tags', op: 'eq', value: tag, valueType: 'text' })));
    setKind('');
    setSort('auto');
    setMode('all');
    setActiveSchema(null);
    setPinnedRowId(null);
    setPendingUrlSearch(true);
  }, [urlTags]);

  // community schemas ride the paginated /api/v1/schemas/browse rail —
  // newest/popular sorts, text search, cursor pagination (same system as
  // /schemas). Loading is lazy (first open) and failures stay non-fatal.
  const schemaRailRef = React.useRef({ schemaQ, schemaSort });
  schemaRailRef.current = { schemaQ, schemaSort };
  const schemaSeqRef = React.useRef(0);
  const loadSchemas = React.useCallback(
    async (options: { cursor?: string | null; sort?: 'newest' | 'popular' } = {}) => {
    const seq = ++schemaSeqRef.current;
    const { cursor } = options;
    setSchemasLoading(true);
    try {
      const rail = schemaRailRef.current;
      // An explicit sort override wins over the ref — a sort button changes the
      // sort and reloads in one click, before the setSchemaSort re-render syncs
      // the ref, so passing it as an argument avoids a stale-ref pre-write dance.
      const sort = options.sort ?? rail.schemaSort;
      const resp: any = await apiRef.current.v1.schemas.browse({
        q: rail.schemaQ.trim() || undefined,
        sort,
        cursor: cursor || undefined,
        limit: 12
      });
      if (seq !== schemaSeqRef.current || !resp?.ok) return;
      // only a SUCCESSFUL first load marks the rail as loaded — a failed or
      // rate-limited first fetch must retry when the rail is next opened
      schemasLoadedRef.current = true;
      const sources = (resp.schemas || [])
        .map(entryToSearchSource)
        .filter((source: SchemaSource | null): source is SchemaSource => !!source);
      setCommunitySchemas((prev) => {
        if (!cursor) return sources;
        const seen = new Set(prev.map((source) => source.key));
        return [...prev, ...sources.filter((source: SchemaSource) => !seen.has(source.key))];
      });
      setSchemaCursor(resp.nextCursor ?? null);
    } catch {
      // schema browsing is sugar — the builder still works without it
    } finally {
      if (seq === schemaSeqRef.current) setSchemasLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!schemasOpen || schemasLoadedRef.current) return;
    loadSchemas();
  }, [schemasOpen, loadSchemas]);

  const schemaSources = React.useMemo(
    () => [...communitySchemas, ...builtinSearchSources()],
    [communitySchemas]
  );

  const applySchema = React.useCallback((source: SchemaSource) => {
    // A selected schema is the new primary query. Clear any Commander text
    // and relevance-only sort left over from the previous search so the
    // generated field filters cannot be silently narrowed to zero results.
    setQ('');
    setSort('auto');
    setActiveSchema(source.key);
    const prefilled = source.fields.map((field) => rowFromSchemaField(field));
    // community data things carry `schema: "<Name>"` by convention — pin that
    // condition first so the prefilled search actually scopes to the shape;
    // builtin schemas scope by their thingtime kind instead
    if (source.origin === 'community') {
      const pinned = newRow({ field: 'schema', op: 'eq', value: source.name, valueType: 'text' });
      prefilled.unshift(pinned);
      setPinnedRowId(pinned.id);
      setKind('data');
    } else {
      // never force a kind the <Select> doesn't offer — a stuck hidden filter
      // would show "any kind" while secretly scoping (or zeroing) the search
      const builtinKind = source.key.replace(/^builtin-/, '');
      setPinnedRowId(null);
      setKind(SEARCHABLE_CRYSTAL_KINDS.has(builtinKind) ? builtinKind : '');
    }
    setRows(prefilled);
    setMode('all');
  }, []);

  // /schemas deep-links here with ?schema=<shareId | builtin:id> — resolve the
  // shape, prefill the refinement form, and run the scoped search.
  const urlSchema = React.useMemo(
    () => new URLSearchParams(location.search).get('schema') || '',
    [location.search]
  );
  const appliedUrlSchemaRef = React.useRef<string | null>(null);
  // render-synced mirror of the CURRENT ?schema — lets an in-flight
  // resolution detect that the user navigated away (urlSchema changed or
  // emptied) and drop its result instead of clobbering the newer search
  const currentUrlSchemaRef = React.useRef(urlSchema);
  currentUrlSchemaRef.current = urlSchema;
  React.useEffect(() => {
    if (!urlSchema || appliedUrlSchemaRef.current === urlSchema) return;
    appliedUrlSchemaRef.current = urlSchema;
    // NO cancel-on-cleanup here: StrictMode's simulated unmount (and our own
    // post-search replace-navigate stripping ?schema) would cancel the only
    // resolution in flight — the ref already dedupes re-runs, and staleness
    // is checked against currentUrlSchemaRef when the async result lands
    (async () => {
      let source: SchemaSource | null = null;
      if (urlSchema.startsWith('builtin:')) {
        const id = urlSchema.slice('builtin:'.length);
        source = builtinSearchSources().find((builtin) => builtin.key === `builtin-${id}`) || null;
      } else {
        try {
          const resp: any = await apiRef.current.v1.things.get({ id: urlSchema });
          if (resp?.ok && resp.thing) source = entryToSearchSource(resp.thing);
        } catch {
          // unknown/invisible schema — fall through to the plain page
        }
      }
      // the user navigated away (or a different ?schema took over) while we
      // resolved — the newer page state owns the search now. Refs freeze on
      // unmount, so mountedRef must be checked too: navigating after unmount
      // would recreate the yank-back bug from this effect.
      if (!mountedRef.current) return;
      if (appliedUrlSchemaRef.current !== urlSchema || currentUrlSchemaRef.current !== urlSchema) return;
      if (!source) {
        lopuRef.current({ title: 'That schema isn’t visible from here 🥲', status: 'info', duration: 6000 });
        // let a revisit of the same link retry the resolution, and strip the
        // dead ?schema so the page returns to plain-visit behavior (cached
        // paint / invite state) — no search anybody didn't ask for
        appliedUrlSchemaRef.current = null;
        const params = new URLSearchParams(window.location.search);
        params.delete('schema');
        navigate({ pathname: '/search', search: params.toString() ? `?${params}` : '' }, { replace: true });
        return;
      }
      // make sure the resolved shape has a chip in the rail even before the
      // rail's own page loads (reset loads may replace it — that's fine)
      if (source.origin === 'community') {
        const resolved = source;
        setCommunitySchemas((prev) => (prev.some((existing) => existing.key === resolved.key) ? prev : [resolved, ...prev]));
      }
      setQ('');
      setSort('auto');
      setSchemasOpen(true);
      applySchema(source);
      setPendingUrlSearch(true);
    })();
  }, [urlSchema, applySchema, navigate]);

  const updateRow = React.useCallback((id: string, patch: Partial<ConditionRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const removeRow = React.useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const activeSchemaSource = React.useMemo(
    () => (activeSchema ? schemaSources.find((source) => source.key === activeSchema) || null : null),
    [activeSchema, schemaSources]
  );

  const fieldSuggestions = React.useMemo(() => {
    const fromSchema = activeSchemaSource?.fields.map((field) => field.name) || [];
    return [...new Set([...fromSchema, ...ROOT_FIELD_SUGGESTIONS])];
  }, [activeSchemaSource]);

  const submit = React.useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      runSearch();
    },
    [runSearch]
  );

  const updateResultPost = React.useCallback((id: string, change: PostChange) => {
    if (change === null) {
      setPosts((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setThings((prev) => prev.filter((thing) => thing.id !== id));
      return;
    }
    setPosts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      const next = typeof change === 'function' ? change(current) : change;
      if (!next) return prev;
      return { ...prev, [id]: next };
    });
  }, []);

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
              {/* instant: the page's centerpiece shouldn't fade in over 10s */}
              <Rainbow instant opacity={0.6} position="absolute" repeats={2} thickness={10} />
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
            {[...SEARCHABLE_CRYSTAL_KINDS].map((kindOption) => (
              <option key={kindOption} value={kindOption}>
                {KIND_OPTION_LABELS[kindOption] || kindOption}
              </option>
            ))}
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
                setPinnedRowId(null);
                setKind('');
              }}
              size="xs"
              variant="ghost"
            >
              Clear filters
            </Button>
          ) : null}
        </Flex>

        {/* schema browser — same paginated rail as /schemas */}
        {schemasOpen ? (
          <Box {...CARD_STYLES} p={4}>
            <Flex align="center" gap={2} mb={3} wrap="wrap">
              <Text color="var(--tt-muted, #9a9aa6)" fontFamily="mono" fontSize="11px" fontWeight="700">
                Pick a shape to search by
              </Text>
              <Box flex={1} />
              <Input
                maxWidth="180px"
                onChange={(event) => setSchemaQ(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    loadSchemas();
                  }
                }}
                placeholder="find a schema…"
                size="xs"
                value={schemaQ}
              />
              <Button
                onClick={() => {
                  setSchemaSort('newest');
                  loadSchemas({ sort: 'newest' });
                }}
                size="xs"
                variant={schemaSort === 'newest' ? 'solid' : 'ghost'}
              >
                Recent
              </Button>
              <Button
                onClick={() => {
                  setSchemaSort('popular');
                  loadSchemas({ sort: 'popular' });
                }}
                size="xs"
                variant={schemaSort === 'popular' ? 'solid' : 'ghost'}
              >
                Popular
              </Button>
            </Flex>
            <Flex gap={2} wrap="wrap">
              {schemaSources.map((source) => (
                <Button
                  key={source.key}
                  colorScheme={activeSchema === source.key ? 'pink' : undefined}
                  onClick={() => applySchema(source)}
                  size="sm"
                  title={[source.description, source.usageCount ? `${source.usageCount} things use this` : '']
                    .filter(Boolean)
                    .join(' · ')}
                  variant={activeSchema === source.key ? 'solid' : 'outline'}
                >
                  {source.name}
                  {source.origin === 'community' ? (
                    <Text as="span" color="var(--tt-muted, #9a9aa6)" fontSize="10px" ml={1.5}>
                      {source.author ? `@${source.author}` : 'community'}
                      {source.usageCount ? ` · ${source.usageCount}` : ''}
                      {source.reactions ? ` · ${source.reactions}❤` : ''}
                    </Text>
                  ) : null}
                </Button>
              ))}
              {!schemaSources.length && !schemasLoading ? (
                <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                  No schemas yet.
                </Text>
              ) : null}
              {schemaCursor ? (
                <Button isLoading={schemasLoading} onClick={() => loadSchemas({ cursor: schemaCursor })} size="sm" variant="ghost">
                  more…
                </Button>
              ) : null}
            </Flex>
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs" mt={3}>
              Browse, fork, and build schemas at{' '}
              <Text as={RouterLink} color="var(--tt-text, #33333c)" textDecoration="underline" to="/schemas">
                /schemas
              </Text>{' '}
              ✨
            </Text>
          </Box>
        ) : null}

        {/* active-schema refinement header — fill only what you care about */}
        {activeSchemaSource ? (
          <Flex align="baseline" gap={2} wrap="wrap">
            <Text color="var(--tt-ink, #16161a)" fontSize="sm" fontWeight="700">
              Refine {activeSchemaSource.name}
            </Text>
            {activeSchemaSource.author ? (
              <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
                @{activeSchemaSource.author}
              </Text>
            ) : null}
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="xs">
              fill only the properties you care about — empty rows are skipped
            </Text>
          </Flex>
        ) : null}

        {/* builder rows */}
        <ConditionRowsEditor
          rows={rows}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          fieldSuggestions={fieldSuggestions}
          datalistId="tt-search-fields"
          renderRow={(row) => {
            // ONLY the row applySchema pinned for a community schema renders
            // as the locked chip (removing it un-scopes the search) — a
            // hand-typed `schema eq X` row stays editable
            if (activeSchemaSource?.origin !== 'community' || row.id !== pinnedRowId) return undefined;
            return (
              <Flex align="center" gap={2}>
                <Flex
                  align="center"
                  background="var(--tt-surface-alt, #f5f5f7)"
                  borderRadius="full"
                  gap={1.5}
                  paddingX={3}
                  paddingY={1}
                >
                  <Sparkles size={12} />
                  <Text color="var(--tt-text, #33333c)" fontSize="xs" fontWeight="600">
                    shape · {row.value}
                  </Text>
                </Flex>
                <IconButton
                  aria-label="Remove shape scope"
                  icon={<X size={14} />}
                  onClick={() => {
                    removeRow(row.id);
                    setActiveSchema(null);
                    setPinnedRowId(null);
                  }}
                  size="sm"
                  variant="ghost"
                />
              </Flex>
            );
          }}
        />

        {/* results */}
        <Flex
          align={{ base: 'stretch', sm: 'center' }}
          gap={3}
          justify="space-between"
          direction={{ base: 'column', sm: 'row' }}
        >
          {totalLabel ? (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
              {totalLabel}
              {ranked ? ' · best match first' : sort === 'oldest' ? ' · oldest first' : ' · newest first'}
            </Text>
          ) : null}
          <Flex
            align="center"
            aria-label="Search result view"
            background="var(--tt-surface-alt, #f5f5f7)"
            border="1px solid var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-sm, 9px)"
            gap={1}
            marginLeft={{ base: 0, sm: 'auto' }}
            p={1}
            role="group"
            width={{ base: '100%', sm: 'auto' }}
          >
            <Button
              aria-pressed={presentation === 'standard'}
              flex={{ base: 1, sm: 'initial' }}
              leftIcon={<Eye size={13} />}
              onClick={() => setPresentation('standard')}
              size="xs"
              variant={presentation === 'standard' ? 'solid' : 'ghost'}
            >
              Standard
            </Button>
            <Button
              aria-pressed={presentation === 'data'}
              flex={{ base: 1, sm: 'initial' }}
              leftIcon={<Braces size={13} />}
              onClick={() => setPresentation('data')}
              size="xs"
              variant={presentation === 'data' ? 'solid' : 'ghost'}
            >
              Data
            </Button>
          </Flex>
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
          {things.map((thing) =>
            presentation === 'standard' ? (
              <StandardThingResult
                key={thing.id}
                onPostChanged={updateResultPost}
                post={posts[thing.id] || null}
                thing={thing}
              />
            ) : (
              <ThingResultCard key={thing.id} post={posts[thing.id] || null} thing={thing} />
            )
          )}
          {/* while a ?schema deep link resolves, neither copy is true yet —
              hold the box until its search settles (which strips ?schema) */}
          {!things.length && !people.length && !loading && !urlSchema ? (
            <Box {...CARD_STYLES} p={8} textAlign="center">
              <Text color="var(--tt-muted, #9a9aa6)">
                {hasSearched
                  ? 'Nothing matched — loosen a filter, or try plain words up top ✨'
                  : 'Type a few words, add a filter, or pick a schema — then hit Search ✨'}
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
