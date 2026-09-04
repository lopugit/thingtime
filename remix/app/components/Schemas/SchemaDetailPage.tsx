import React from 'react';
import { Badge, Box, Button, Flex, Text } from '@chakra-ui/react';
import { ArrowLeft, BookOpen, ExternalLink, Link as LinkIcon, Search } from 'lucide-react';
import { Link, useParams } from 'react-router';

import { timeAgo } from '~/components/Feed/feedTypes';
import { RenderThing } from '~/components/Kinds';
import { useLopu } from '~/components/Lopu/useLopu';
import { thingDetailPath } from '~/components/Search/commanderSearch';
import { SchemaTemplateRender } from '~/components/Things/ThingsViews';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { clearLocalCache, readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { getThingtimeSchema } from '~/schemas/registry';
import { describeSchemaField, flattenSchemaFieldsForDisplay } from '~/schemas/tools';
import { CARD_STYLES } from '~/theme/card';
import { getUserDisplayName, getUserIdentityDetail } from '~/utils/userIdentity';

import { SampleRender, ShapeChip, kindOf, monoLabel, systemThingFields } from './SchemasBrowsePage';
import { SchemaThingFormBody } from './SchemaThingForm';
import {
  SCHEMAS_LEGACY_CACHE_KEY,
  builtinSchemaForKey,
  cachedSchemaEntry,
  entryToCardSource,
  parseSchemaDetailKey,
  registryToCardSource,
  schemaDetailKeyFor,
  schemaDetailPath,
  schemaSearchPath,
  searchableSchemaSource,
  type BrowseSchemaEntry,
  type SchemaCardSource
} from './schemaBrowseTypes';

// /schemas/:key — one schema on its own page. PREVIEW: the header, the full
// field tree, the on-create shape, and the schema's render preview. LIVE: the
// create-a-thing form inline (the same SchemaThingFormBody the browse modal
// wraps) and "Your things with this shape" — the viewer's OWN data things of
// this schema, newest first.
//
// Trust: nothing on this page arms a control. A schema is a shape, not a
// program — its render (and the render drawn over the viewer's own things
// below) goes through SchemaTemplateRender, the same {field}-interpolation +
// sanitising-renderer path /things and /thing/:id draw a data thing with, and
// never a click wrapper — so a stranger's render markup can never run
// anything as the viewer. The only writes are the viewer creating their own
// thing, sign-in gated.
//
// :key resolves builtin-first (builtin:<id>, the bare registry id, or the
// seeded mirror's shareId schema-<id> all show the registry entry), then a
// community schema thing by shareId — the rule lives in schemaBrowseTypes so
// cards, deep links, and this page speak one key. A community schema paints
// from the browse page's per-user snapshot before its own fetch lands.

const OWN_THINGS_LIMIT = 24;
// Per-viewer, per-schema last-known list of their own things — the flash-free
// tier for a revisit (house rule: never a spinner when a last-known value
// exists). Keyed by user so no other account can paint from it.
const ownThingsCacheKey = (userId: string, schemaKey: string) => `tt-schema-things-${userId}:${schemaKey}`;

type OwnThing = {
  id: string;
  thingtime: string[];
  crystal: Record<string, any>;
  createdAt: string;
};

const asOwnThing = (thing: unknown): OwnThing | null => {
  if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return null;
  const record = thing as Record<string, unknown>;
  if (typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    thingtime: Array.isArray(record.thingtime) ? record.thingtime.filter((entry): entry is string => typeof entry === 'string') : [],
    crystal: record.crystal && typeof record.crystal === 'object' && !Array.isArray(record.crystal) ? (record.crystal as Record<string, any>) : {},
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : ''
  };
};

// provenance keys the create form stamps — not data the viewer typed
const PROVENANCE_KEYS = new Set(['schema', 'schemaId']);

const previewText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
};

const titleOf = (thing: OwnThing): string => {
  const candidate = thing.crystal.name ?? thing.crystal.title ?? thing.crystal.text;
  const text = previewText(candidate);
  return text.slice(0, 120);
};

// Honest key/value fallback when neither the schema render nor a kind
// renderer draws the thing — the viewer's own values, provenance stripped.
const CrystalChips = ({ crystal }: { crystal: Record<string, any> }) => {
  const entries = Object.entries(crystal)
    .filter(([key]) => !PROVENANCE_KEYS.has(key))
    .slice(0, 12);
  if (!entries.length) {
    return (
      <Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
        Just the schema tag — no values yet.
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
          <Text color="var(--tt-text, #33333c)" fontSize="13px" noOfLines={2} wordBreak="break-word">
            {previewText(value).slice(0, 160)}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
};

const OwnThingCard = ({ thing, source }: { thing: OwnThing; source: SchemaCardSource }) => {
  const title = titleOf(thing);
  const rendered = React.useMemo(() => ({ kind: kindOf(source.name), ...thing.crystal }), [source.name, thing.crystal]);
  return (
    <Box {...CARD_STYLES} minWidth={0} padding={3} data-testid="schema-detail-own-thing">
      <Flex align="center" gap={2} marginBottom={2} wrap="wrap">
        {title ? (
          <Text color="var(--tt-ink, #16161a)" fontSize="13px" fontWeight={600} minWidth={0} noOfLines={1} wordBreak="break-word">
            {title}
          </Text>
        ) : (
          <Text color="var(--tt-faint, #b6b6c0)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px">
            {thing.id}
          </Text>
        )}
        <Box flex={1} />
        {thing.createdAt ? (
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px" whiteSpace="nowrap">
            {timeAgo(thing.createdAt)}
          </Text>
        ) : null}
        <Flex
          align="center"
          as={Link}
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
      {source.render ? (
        // the schema's render over the viewer's own values — INERT: {field}
        // tokens interpolate, the tree goes through the sanitising renderers,
        // and there is no click wrapper, whoever authored the render
        <SchemaTemplateRender crystal={thing.crystal} template={source.render} />
      ) : (
        <RenderThing context={{ size: 'card' }} fallback={<CrystalChips crystal={thing.crystal} />} thing={rendered} />
      )}
    </Box>
  );
};

export const SchemaDetailPage = () => {
  const { key: rawKey } = useParams();
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;

  const key = (rawKey || '').trim();
  const builtin = React.useMemo(() => (key ? builtinSchemaForKey(key) : null), [key]);
  const parsed = React.useMemo(() => parseSchemaDetailKey(key), [key]);
  const communityId = !builtin && parsed?.origin === 'community' ? parsed.id : null;

  // Same purge the browse page performs: the pre-scoping global blob may
  // hold another account's viewer-scoped schemas and must never paint here.
  React.useEffect(() => {
    clearLocalCache(SCHEMAS_LEGACY_CACHE_KEY);
  }, []);

  // community: last-known browse entry first (viewer's own snapshot), then
  // the fetched thing reconciles it
  const [entry, setEntry] = React.useState<BrowseSchemaEntry | null>(() => (communityId ? cachedSchemaEntry(user?.id, communityId) : null));
  // usage count only when the browse API told us (the thing read has none)
  const [usageCount, setUsageCount] = React.useState<number | null>(() =>
    communityId ? (cachedSchemaEntry(user?.id, communityId)?.usageCount ?? null) : null
  );
  const [notFound, setNotFound] = React.useState(!key || (!builtin && !communityId));

  React.useEffect(() => {
    if (!communityId) {
      setEntry(null);
      setUsageCount(null);
      setNotFound(!key || !builtin);
      return;
    }
    const cached = cachedSchemaEntry(user?.id, communityId);
    setEntry(cached);
    setUsageCount(cached?.usageCount ?? null);
    setNotFound(false);
    let cancelled = false;
    (async () => {
      try {
        const resp: any = await apiRef.current.v1.things.get({ id: communityId });
        if (cancelled) return;
        const thing = resp?.ok && resp.thing && typeof resp.thing === 'object' ? resp.thing : null;
        if (!thing || !Array.isArray(thing.thingtime) || !thing.thingtime.includes('schema')) {
          setEntry(null);
          setNotFound(true);
          return;
        }
        setEntry((prev) => ({
          ...thing,
          reactionCounts: prev?.reactionCounts || {},
          viewerReactions: prev?.viewerReactions || [],
          saved: prev?.saved || false,
          usageCount: prev?.usageCount ?? 0
        }));
      } catch {
        if (cancelled) return;
        // unknown / invisible schema — only a not-found when nothing painted
        setEntry((prev) => {
          if (!prev) setNotFound(true);
          return prev;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [communityId, key, builtin, user?.id]);

  const source = React.useMemo<SchemaCardSource | null>(() => {
    if (builtin) return registryToCardSource(builtin);
    return entry ? entryToCardSource(entry) : null;
  }, [builtin, entry]);

  React.useEffect(() => {
    if (typeof document !== 'undefined' && source) document.title = `${source.name} · Schemas · Thingtime`;
  }, [source]);

  const registry = source?.registry;
  const isRoot = registry?.kind === 'root';
  const flat = React.useMemo(() => flattenSchemaFieldsForDisplay(source?.fields), [source?.fields]);
  const appliedIds = React.useMemo(() => (isRoot || !source ? [] : registry ? registry.appliedThingtime || [registry.id] : ['data']), [isRoot, registry, source]);
  const inherits = isRoot ? [] : ['thing', ...appliedIds.filter((id) => id !== registry?.id)];
  const crystalFieldNames = React.useMemo(() => {
    if (!source) return [];
    if (!registry) return ['schema', ...source.fields.map((field) => field.name)];
    return appliedIds.flatMap((id) => (getThingtimeSchema(id)?.fields || []).map((field) => field.name));
  }, [source, registry, appliedIds]);
  const systemFields = React.useMemo(systemThingFields, []);
  const searchable = source ? searchableSchemaSource(source) : false;
  const schemaKey = source ? schemaDetailKeyFor(source) : key;

  // ---- your things with this shape -----------------------------------------

  const ownCacheKey = user?.id && source ? ownThingsCacheKey(user.id, schemaKey) : null;
  const [ownThings, setOwnThings] = React.useState<OwnThing[] | null>(() =>
    ownCacheKey ? readLocalCache<OwnThing[]>(ownCacheKey) : null
  );
  const [ownLoading, setOwnLoading] = React.useState(false);
  const ownSeqRef = React.useRef(0);
  const [ownVersion, setOwnVersion] = React.useState(0);
  const refetchOwn = React.useCallback(() => setOwnVersion((current) => current + 1), []);

  const ownQueryKey = source && user ? JSON.stringify({ o: source.origin, i: source.id, n: source.name, u: user.username, s: searchable }) : null;
  React.useEffect(() => {
    if (!ownQueryKey || !source || !user || !searchable) {
      setOwnThings(null);
      return;
    }
    // paint the last-known list for this viewer + schema before refetching
    setOwnThings(ownCacheKey ? readLocalCache<OwnThing[]>(ownCacheKey) : null);
    const seq = ++ownSeqRef.current;
    let cancelled = false;
    setOwnLoading(true);
    (async () => {
      try {
        // the same grammar /search speaks: crystal.schema (name) OR
        // crystal.schemaId (the schema thing's id), scoped to the viewer's
        // own data things, newest first
        const resp: any = await apiRef.current.v1.things.search({
          thingtime: 'data',
          author: user.username,
          mode: 'any',
          conditions: [
            { field: 'schema', op: 'eq', value: source.name },
            ...(source.origin === 'community' ? [{ field: 'schemaId', op: 'eq', value: source.id }] : [])
          ],
          sort: 'newest',
          limit: OWN_THINGS_LIMIT
        });
        if (cancelled || seq !== ownSeqRef.current) return;
        if (!resp?.ok) throw resp;
        const things = (Array.isArray(resp.things) ? resp.things : []).map(asOwnThing).filter(Boolean) as OwnThing[];
        setOwnThings(things);
        if (ownCacheKey) writeLocalCache(ownCacheKey, things.slice(0, OWN_THINGS_LIMIT));
      } catch (err: any) {
        if (cancelled || seq !== ownSeqRef.current) return;
        setOwnThings((prev) => prev || []);
        lopuRef.current({ title: err?.error || 'Couldn’t list your things — try again 🌈', status: 'error' });
      } finally {
        if (!cancelled && seq === ownSeqRef.current) setOwnLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ownQueryKey is the serialised form of source + viewer; ownVersion is the refetch signal
  }, [ownQueryKey, ownVersion]);

  const handleCreated = React.useCallback(
    (thing: Record<string, any> | null) => {
      const created = asOwnThing(thing);
      if (created) {
        // optimistic: the new thing leads the list, the refetch reconciles
        setOwnThings((prev) => [created, ...(prev || []).filter((existing) => existing.id !== created.id)].slice(0, OWN_THINGS_LIMIT));
      }
      refetchOwn();
    },
    [refetchOwn]
  );

  const copyLink = () => {
    if (!source) return;
    const url = `${window.location.origin}${schemaDetailPath(source)}`;
    navigator.clipboard?.writeText(url).then(
      () => lopuRef.current({ title: 'Link copied 🔗', status: 'success', duration: 2500 }),
      () => lopuRef.current({ title: url, status: 'info', duration: 8000 })
    );
  };

  const communityEntry = source?.entry;

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex
        data-testid="schema-detail-page"
        direction="column"
        gap={5}
        maxWidth="860px"
        minWidth={0}
        pb={24}
        paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 36px)"
        px={4}
        width="100%"
      >
        <Flex align="center" gap={2}>
          <Button as={Link} leftIcon={<ArrowLeft size={14} />} size="xs" to="/schemas" variant="ghost">
            Schemas
          </Button>
          <Box flex={1} />
          {source && (
            <Button leftIcon={<LinkIcon size={13} />} onClick={copyLink} size="xs" variant="ghost">
              Copy link
            </Button>
          )}
        </Flex>

        {!source && !notFound && (
          <Box color="var(--tt-muted, #9a9aa6)" padding={10} textAlign="center">
            Loading schema…
          </Box>
        )}

        {!source && notFound && (
          <Box
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            color="var(--tt-muted, #9a9aa6)"
            padding={10}
            textAlign="center"
            data-testid="schema-detail-not-found"
          >
            No schema answers to “{key}” — it may be private, gone, or never have existed. Browse /schemas instead 🌈
          </Box>
        )}

        {source && (
          <>
            {/* ------------------------------ header ------------------------------ */}
            <Flex align="center" gap={2} minWidth={0} wrap="wrap">
              <Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={800} minWidth={0} wordBreak="break-word">
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
              {usageCount !== null && usageCount > 0 && (
                <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="10px" textTransform="none">
                  {usageCount} thing{usageCount === 1 ? '' : 's'} use this
                </Badge>
              )}
              {source.forkOf && (
                <Badge
                  as={Link}
                  background="transparent"
                  color="var(--tt-faint, #b6b6c0)"
                  fontSize="10px"
                  textTransform="none"
                  to={schemaDetailPath({ origin: 'community', id: source.forkOf })}
                  _hover={{ textDecoration: 'underline' }}
                >
                  forked from {source.forkOf}
                </Badge>
              )}
            </Flex>
            <Flex align="center" gap={2} marginTop={-3} wrap="wrap">
              <Text color="var(--tt-faint, #b6b6c0)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" wordBreak="break-all">
                {schemaKey}
              </Text>
              {communityEntry && (
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                  · {communityEntry.author ? getUserDisplayName(communityEntry.author) : 'anon'}
                  {communityEntry.author?.temporary ? ` · ${getUserIdentityDetail(communityEntry.author)}` : ''} · {timeAgo(communityEntry.createdAt)}
                </Text>
              )}
            </Flex>

            {source.description && (
              <Text color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.6">
                {source.description}
              </Text>
            )}

            <Flex gap={2} wrap="wrap">
              {searchable && (
                <Button as={Link} leftIcon={<Search size={14} />} size="xs" to={schemaSearchPath(source)} variant="outline">
                  Search things
                </Button>
              )}
              {source.origin === 'builtin' && (
                <Button as="a" href={`/docs/schemas#schema-${source.id}`} leftIcon={<BookOpen size={14} />} size="xs" variant="ghost">
                  Docs
                </Button>
              )}
            </Flex>

            {inherits.length > 0 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel}>inherits</Text>
                {inherits.map((id) => (
                  <Badge
                    background="var(--tt-surface, #fafafb)"
                    border="1px solid var(--tt-border, #ececef)"
                    borderRadius="full"
                    color="var(--tt-text, #33333c)"
                    fontSize="10px"
                    key={id}
                    paddingX={2}
                    textTransform="none"
                    title={getThingtimeSchema(id)?.summary}
                  >
                    {getThingtimeSchema(id)?.title || id}
                  </Badge>
                ))}
              </Flex>
            )}

            {/* ------------------------------ fields ------------------------------ */}
            <Flex direction="column" gap={2} data-testid="schema-detail-fields">
              <Text {...monoLabel}>fields ({flat.length})</Text>
              {flat.length === 0 && (
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="sm">
                  No fields — things of this shape just carry the schema tag.
                </Text>
              )}
              {flat.map((field) => {
                const system = Boolean((field.field as { system?: boolean }).system);
                return (
                  <Flex
                    align="baseline"
                    background="var(--tt-surface-alt, #f5f5f7)"
                    borderRadius="var(--tt-radius-xs, 7px)"
                    gap={2}
                    key={field.path}
                    marginLeft={Math.min(field.depth, 6) * 4}
                    minWidth={0}
                    opacity={system ? 0.75 : 1}
                    paddingX={2.5}
                    paddingY={1.5}
                    wrap="wrap"
                  >
                    <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" wordBreak="break-all">
                      {field.path}
                      {field.field.required ? ' *' : ''}
                    </Text>
                    <Text color="var(--tt-muted, #9a9aa6)" fontSize="11px">
                      {describeSchemaField(field.field)}
                      {field.inArray ? ' · in list' : ''}
                      {system ? ' ⚙' : ''}
                    </Text>
                    {field.field.description && (
                      <Text color="var(--tt-faint, #b6b6c0)" flexBasis="100%" fontSize="12px" lineHeight="1.5">
                        {field.field.description}
                      </Text>
                    )}
                  </Flex>
                );
              })}
            </Flex>

            {!isRoot && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel}>on create</Text>
                {registry?.createdVia ? (
                  <ShapeChip>via {registry.createdVia}</ShapeChip>
                ) : (
                  <>
                    <ShapeChip>thingtime: [{appliedIds.map((id) => `"${id}"`).join(', ')}]</ShapeChip>
                    {registry?.requiresTarget && <ShapeChip>targetId *</ShapeChip>}
                    <ShapeChip>
                      crystal: {'{ '}
                      {crystalFieldNames.length ? crystalFieldNames.join(', ') : '…'}
                      {' }'}
                    </ShapeChip>
                    <ShapeChip dim>acl?</ShapeChip>
                    <ShapeChip dim>tags?</ShapeChip>
                    <ShapeChip dim>extended?</ShapeChip>
                  </>
                )}
              </Flex>
            )}

            {!isRoot && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel} title="System props stamped by Thingtime — from the root Thing schema every thing inherits">
                  thingtime adds
                </Text>
                {systemFields.map((field) => (
                  <ShapeChip dim key={field.name}>
                    {field.name}: {describeSchemaField(field)}
                  </ShapeChip>
                ))}
              </Flex>
            )}

            {/* ------------------------------ preview ------------------------------ */}
            <Flex direction="column" gap={1.5} data-testid="schema-detail-preview">
              <Text {...monoLabel}>{source.render ? 'render preview' : 'sample'}</Text>
              <SampleRender source={source} />
              {source.render && (
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                  The schema’s own render template, drawn through the sanitising renderers — preview only, nothing here runs.
                </Text>
              )}
            </Flex>

            {/* ------------------------------ create ------------------------------ */}
            {!isRoot && (
              <Flex {...CARD_STYLES} direction="column" gap={3} padding={4} data-testid="schema-detail-form">
                <Text color="var(--tt-ink, #16161a)" fontSize="md" fontWeight={700}>
                  New {source.name} ✨
                </Text>
                {user ? (
                  <SchemaThingFormBody onCreated={handleCreated} resetOnCreate source={source} />
                ) : (
                  <Flex align="center" gap={3} wrap="wrap">
                    <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                      Sign in to create a thing with this shape — it lands in your own things.
                    </Text>
                    <Button as={Link} size="xs" to="/login">
                      Sign in
                    </Button>
                  </Flex>
                )}
              </Flex>
            )}

            {/* ------------------------------ your things ------------------------------ */}
            {!isRoot && (
              <Flex direction="column" gap={3} data-testid="schema-detail-own-things">
                <Flex align="baseline" gap={2} wrap="wrap">
                  <Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={700}>
                    Your things with this shape
                  </Text>
                  {ownThings && ownThings.length > 0 && (
                    <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
                      {ownThings.length}
                      {ownThings.length >= OWN_THINGS_LIMIT ? '+' : ''} · newest first
                    </Text>
                  )}
                </Flex>
                {!user ? (
                  <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                    Sign in to see the things you’ve made with this shape.
                  </Text>
                ) : !searchable ? (
                  <Box border="1px dashed var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" color="var(--tt-muted, #9a9aa6)" fontSize="sm" padding={6} textAlign="center">
                    {source.fields.length === 0
                      ? 'This shape has no fields, so there’s nothing to list things by.'
                      : `${source.name} things aren’t listable here — this kind lives outside the generic things search.`}
                  </Box>
                ) : ownThings === null ? (
                  <Text color="var(--tt-muted, #9a9aa6)" fontSize="sm">
                    {ownLoading ? 'Looking for your things…' : ''}
                  </Text>
                ) : ownThings.length === 0 ? (
                  <Box border="1px dashed var(--tt-border, #ececef)" borderRadius="var(--tt-radius-lg, 16px)" color="var(--tt-muted, #9a9aa6)" fontSize="sm" padding={6} textAlign="center">
                    Nothing yet — create the first one above ✨
                  </Box>
                ) : (
                  <>
                    {source.render && (
                      <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                        Drawn through this schema’s render template over your own values — preview only, nothing here runs.
                      </Text>
                    )}
                    <Flex direction="column" gap={3}>
                      {ownThings.map((thing) => (
                        <OwnThingCard key={thing.id} source={source} thing={thing} />
                      ))}
                    </Flex>
                  </>
                )}
              </Flex>
            )}
          </>
        )}
      </Flex>
    </Flex>
  );
};
