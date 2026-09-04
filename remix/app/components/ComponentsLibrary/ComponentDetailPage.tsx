import React from 'react';
import { Badge, Box, Button, Center, Flex, Input, Select, Text, Textarea } from '@chakra-ui/react';
import { ArrowLeft, Link as LinkIcon } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';

import { useActionRunConfirm } from '~/components/Actions/ActionRunConfirm';
import type { TtActionConfirmHandler, TtActionUnownedHandler } from '~/components/Actions/useTtActionClicks';
import { installSuite, installSuiteOnServer, suiteKeyFromActionKey } from '~/components/Builder/installSuite';
import { LiveTemplate, useComponentArgValues, useThingSource } from '~/components/Builder/liveComponent';
import type { ThingSourceBinding } from '~/components/Builder/liveComponent';
import { WebpageRuntimeProvider } from '~/components/Builder/webpageRuntime';
import { ChakraThingRenderer, HtmlThingRenderer, isChakraThingNode } from '~/components/Kinds';
import type { ChakraThingNode, HtmlThingNode } from '~/components/Kinds';
import { isSafeCssText } from '~/components/Kinds/safeUrl';
import { useLopu } from '~/components/Lopu/useLopu';
import { readLocalCache, writeLocalCache } from '~/hooks/localCache';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
// the REGISTRY module (not just the lookups): importing it registers the app
// suites, so a cold load of /components/app-pokeworld-hud knows the part
// belongs to an installable app
import { ALL_SUITES } from '~/schemas/appSuites/index';
import { materializeSuite, suiteSlug } from '~/schemas/behaviourSuites';
import type { BehaviourSuite, MaterializedSuite } from '~/schemas/behaviourSuites';
import { ACL_OWNER, DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS, getThingtimeSchema } from '~/schemas/registry';
import type { SchemaThingField } from '~/schemas/registry';
import { describeSchemaField } from '~/schemas/tools';

import {
  COMPONENT_LIBRARY_LABELS,
  RESERVED_COMPONENT_ID_PREFIX,
  SOURCE_REFRESH_MODES,
  catalogEntryFrom,
  clampSourceInterval,
  componentTrustFor,
  designRank,
  entryToCardSource,
  isAttributionTag,
  isSourceActionKey,
  parseSourceBindingParams,
  parseSourceInputsJson,
  pickActiveSource,
  sourceBindingToParams,
  type BrowseComponentEntry,
  type BrowseComponentsResponse,
  type ComponentCardSource,
  type ComponentTrust,
  type SourceRefreshMode
} from './componentBrowseTypes';
import {
  coerceArgValue,
  defaultsFromArgs,
  resolveTemplate,
  type ComponentArgSpec,
  type ComponentArgValues
} from './componentTemplate';

// /components/:key (+ /docs) — a component family's own deep-linked page:
// design switcher, the LIVE pane (the real thing: the shared live-component
// path under the page runtime, bound to a data source from the URL), the
// static preview, args tester, and full documentation (args reference, API
// usage, raw definition). :key resolves a familyKey, a componentKey slug, or a
// seeded shareId (component-<slug>); ?design=<library|id> picks the
// rendition; ?source=<actionKey>&refresh=…&interval=…&inputs=… binds the
// live pane's data (never persisted to the thing).
//
// Trust ladder (the p.tsx / PreviewModal rule): the viewer's OWN thing is
// live with no confirm; a system-seeded platform / demo / app component is
// live for a signed-in viewer behind the confirm gate, and a control naming
// an action they do not own installs the suite and re-runs the same click;
// a stranger's thing renders the same markup with no handler.

const monoLabel = {
  color: 'var(--tt-muted, #9a9aa6)',
  fontFamily: 'var(--tt-font-mono, monospace)',
  fontSize: '11px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const
};

const fieldProps = {
  background: 'var(--tt-card, #ffffff)',
  borderColor: 'var(--tt-border, #ececef)',
  fontSize: '13px',
  size: 'sm' as const
};

const systemThingFields = () =>
  ((getThingtimeSchema('thing')?.fields || []) as unknown as SchemaThingField[]).filter(
    (field) => (field as { system?: boolean }).system
  );

const describeArg = (spec: ComponentArgSpec): string => {
  if (spec.type === 'enum') return `enum ${(spec.values || []).join(' | ')}`;
  if (spec.type === 'number') {
    const bounds = [spec.min, spec.max].filter((value) => typeof value === 'number');
    return bounds.length ? `number ${bounds.join('–')}` : 'number';
  }
  if (spec.type === 'string' && spec.maxLength) return `string ≤${spec.maxLength}`;
  return spec.type;
};

// ---------------------------------------------------------------------------
// The code catalog: suite parts materialised on the client. Memoised per
// suite — the definitions are static code, and one page asks twice (first
// paint + the suggested sources).

const materializedSuites = new Map<string, MaterializedSuite>();
const materializedSuite = (suite: BehaviourSuite): MaterializedSuite => {
  const cached = materializedSuites.get(suite.key);
  if (cached) return cached;
  const built = materializeSuite(suite, 'system');
  materializedSuites.set(suite.key, built);
  return built;
};
const suiteByKey = (key: string | null): BehaviourSuite | null => (key ? ALL_SUITES.find((suite) => suite.key === key) || null : null);
const suiteKeyOfComponent = (componentKey: string): string | null => suiteKeyFromActionKey(componentKey, ALL_SUITES);

// the slug a URL key names: the reserved shareId form strips its prefix
const slugOfKey = (key: string): string =>
  key.startsWith(RESERVED_COMPONENT_ID_PREFIX) ? key.slice(RESERVED_COMPONENT_ID_PREFIX.length) : key;

// a suite component paints from code before the API answers (house rule:
// never a loading state when a last-known value exists)
const catalogEntriesFor = (key: string): BrowseComponentEntry[] => {
  const slug = slugOfKey(key);
  const suite = suiteByKey(suiteKeyOfComponent(slug));
  if (!suite) return [];
  const part = materializedSuite(suite).components.find((component) => component.slug === slug || component.shareId === key);
  return part ? [catalogEntryFrom(part.shareId, part.crystal)] : [];
};

const walkBlocks = (blocks: unknown, visit: (block: Record<string, unknown>) => void): void => {
  if (!Array.isArray(blocks)) return;
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    visit(block as Record<string, unknown>);
    walkBlocks((block as { children?: unknown }).children, visit);
  }
};

// the bindings the suite's own pages give this component — offered as
// one-tap suggestions on the data source control
const suiteSourcesFor = (suite: BehaviourSuite, componentKey: string): ThingSourceBinding[] => {
  const out = new Map<string, ThingSourceBinding>();
  for (const page of materializedSuite(suite).pages) {
    walkBlocks((page.crystal as { blocks?: unknown }).blocks, (block) => {
      if (block.type !== 'component' || block.component !== componentKey) return;
      const source = block.source as Partial<ThingSourceBinding> | undefined;
      if (!source || typeof source.action !== 'string' || !isSourceActionKey(source.action) || out.has(source.action)) return;
      out.set(source.action, {
        action: source.action,
        ...(source.inputs && typeof source.inputs === 'object' ? { inputs: source.inputs } : {}),
        ...(source.refresh ? { refresh: source.refresh } : {}),
        ...(source.intervalMs ? { intervalMs: source.intervalMs } : {})
      });
    });
  }
  return [...out.values()];
};

// the confirm dialog names a suite program by its title, not just its slug
const resolveActionName = (action: string): string | null => {
  const suite = suiteByKey(suiteKeyFromActionKey(action, ALL_SUITES));
  const part = suite?.actions.find((candidate) => suiteSlug(suite.key, candidate.key) === action);
  return part ? part.name : null;
};

const familyCacheKeyFor = (viewerId: string | null, key: string): string | null =>
  viewerId && key ? `tt-component-family-${viewerId}:${key}` : null;

const TRUST_LABELS: Record<ComponentTrust, string> = {
  owner: 'yours · live',
  seeded: 'platform · live',
  stranger: 'inert'
};

// ---------------------------------------------------------------------------
// The live pane — the ONE live-component path (liveComponent.tsx) under the
// page runtime: the tester's arg values merge with the source scope, and the
// click wrapper arms only when the trust ladder says so.

const LivePane = ({
  source,
  values,
  binding,
  interactive,
  confirm,
  onUnowned
}: {
  source: ComponentCardSource;
  values: ComponentArgValues;
  binding: ThingSourceBinding | null;
  interactive: boolean;
  confirm?: TtActionConfirmHandler;
  onUnowned?: TtActionUnownedHandler;
}) => {
  const { argValues } = useComponentArgValues(source.entry.crystal, values);
  const live = useThingSource({ source: binding, cacheId: source.id, argValues, interactive });
  const scope = React.useMemo(() => ({ ...argValues, ...live.scope }), [argValues, live.scope]);
  const background = source.previewBg && isSafeCssText(source.previewBg) ? source.previewBg : 'var(--tt-surface, #fafafb)';
  const status = live.scope.state;
  return (
    <Flex direction="column" gap={2}>
      {binding && (
        <Flex align="center" gap={2} minWidth={0} wrap="wrap" data-testid="component-live-source">
          <Text {...monoLabel}>source</Text>
          <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" wordBreak="break-all">
            {binding.action}
          </Text>
          <Badge
            background="var(--tt-surface-alt, #f5f5f7)"
            border="1px solid var(--tt-border, #ececef)"
            borderRadius="full"
            color={status === 'error' ? 'var(--tt-danger, #d6455a)' : 'var(--tt-muted, #9a9aa6)'}
            fontSize="10px"
            paddingX={2}
            textTransform="none"
            data-testid="component-live-state"
          >
            {status}
            {binding.refresh === 'interval' ? ` · every ${Math.round((binding.intervalMs || DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS) / 1000)}s` : ''}
          </Badge>
          {live.scope.error && (
            <Text color="var(--tt-danger, #d6455a)" fontSize="11px">
              {live.scope.error}
            </Text>
          )}
          {status === 'not-installed' && (
            <Text color="var(--tt-muted, #9a9aa6)" fontSize="11px">
              you don’t own this action yet — press a control to install it
            </Text>
          )}
          <Box flex={1} />
          <Button
            color="var(--tt-muted, #9a9aa6)"
            fontSize="11px"
            isDisabled={!interactive || !live.scope.viewer || status === 'signed-out'}
            onClick={live.refetch}
            size="xs"
            variant="ghost"
            data-testid="component-live-refetch"
          >
            ↻ refresh
          </Button>
        </Flex>
      )}
      <Center
        background={background}
        border="1px solid var(--tt-border, #ececef)"
        borderRadius="var(--tt-radius-lg, 16px)"
        minHeight="180px"
        overflow="hidden"
        padding={{ base: 4, md: 8 }}
        data-testid="component-live"
        data-trust={interactive ? 'live' : 'inert'}
      >
        <Box maxWidth="100%" width="100%" sx={{ '& > *': { maxWidth: '100%' } }}>
          <LiveTemplate confirm={confirm} interactive={interactive} onUnowned={onUnowned} render={source.render} scope={scope} />
        </Box>
      </Center>
    </Flex>
  );
};

// ---------------------------------------------------------------------------
// The data source control — sits OUTSIDE the live element (the click wrapper
// reads named fields from a control's <fieldset>, and this is not a control).
// Edits stay local until Bind writes them to the URL.

type SourceDraft = { action: string; refresh: SourceRefreshMode; intervalMs: string; inputs: string };

const draftFrom = (binding: ThingSourceBinding | null): SourceDraft => ({
  action: binding?.action || '',
  refresh: binding?.refresh || 'load',
  intervalMs: String(binding?.intervalMs || DEFAULT_WEBPAGE_SOURCE_INTERVAL_MS),
  inputs: binding?.inputs ? JSON.stringify(binding.inputs) : ''
});

const SourceControl = ({
  binding,
  suggestions,
  onBind
}: {
  binding: ThingSourceBinding | null;
  suggestions: ThingSourceBinding[];
  onBind: (binding: ThingSourceBinding | null) => void;
}) => {
  const bindingKey = JSON.stringify(binding);
  const [draft, setDraft] = React.useState<SourceDraft>(() => draftFrom(binding));
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    setDraft(draftFrom(binding));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bindingKey is the serialised binding
  }, [bindingKey]);

  const apply = () => {
    const action = draft.action.trim();
    if (!action) {
      setError(null);
      onBind(null);
      return;
    }
    if (!isSourceActionKey(action)) {
      setError('Name the action by its actionKey — a lowercase-dashed slug like app-pokeworld-state');
      return;
    }
    const parsed = parseSourceInputsJson(draft.inputs);
    // an explicit discriminant check — this project compiles without
    // strictNullChecks, where `!parsed.ok` does not narrow the union
    if (parsed.ok === false) {
      setError(parsed.error);
      return;
    }
    setError(null);
    onBind({
      action,
      refresh: draft.refresh,
      ...(draft.refresh === 'interval' ? { intervalMs: clampSourceInterval(draft.intervalMs) } : {}),
      ...(parsed.inputs ? { inputs: parsed.inputs } : {})
    });
  };

  return (
    <Flex direction="column" gap={2} data-testid="component-source-control">
      <Text {...monoLabel}>data source</Text>
      <Flex align="center" gap={2} wrap="wrap">
        <Input
          {...fieldProps}
          flex="1 1 200px"
          fontFamily="var(--tt-font-mono, monospace)"
          minWidth={0}
          onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              apply();
            }
          }}
          placeholder="actionKey · e.g. app-pokeworld-state"
          value={draft.action}
          data-testid="component-source-action"
        />
        <Select
          {...fieldProps}
          flex="0 1 130px"
          onChange={(event) => setDraft((current) => ({ ...current, refresh: event.target.value as SourceRefreshMode }))}
          value={draft.refresh}
          data-testid="component-source-refresh"
        >
          {SOURCE_REFRESH_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode === 'load' ? 'on load' : mode}
            </option>
          ))}
        </Select>
        {draft.refresh === 'interval' && (
          <Input
            {...fieldProps}
            flex="0 1 110px"
            min={5000}
            onChange={(event) => setDraft((current) => ({ ...current, intervalMs: event.target.value }))}
            placeholder="ms"
            step={1000}
            type="number"
            value={draft.intervalMs}
            data-testid="component-source-interval"
          />
        )}
        <Button colorScheme="pink" onClick={apply} size="sm" variant={binding ? 'outline' : 'solid'} data-testid="component-source-bind">
          {binding ? 'Rebind' : 'Bind'}
        </Button>
        {binding && (
          <Button color="var(--tt-muted, #9a9aa6)" onClick={() => onBind(null)} size="sm" variant="ghost" data-testid="component-source-clear">
            Clear
          </Button>
        )}
      </Flex>
      <Textarea
        {...fieldProps}
        fontFamily="var(--tt-font-mono, monospace)"
        onChange={(event) => setDraft((current) => ({ ...current, inputs: event.target.value }))}
        placeholder='inputs JSON · optional · e.g. {"id": "{query.id}"}'
        rows={2}
        value={draft.inputs}
        data-testid="component-source-inputs"
      />
      {error && (
        <Text color="var(--tt-danger, #d6455a)" fontSize="11px">
          {error}
        </Text>
      )}
      {suggestions.length > 0 && (
        <Flex align="center" gap={1.5} wrap="wrap">
          <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
            the suite binds it to
          </Text>
          {suggestions.map((suggestion) => (
            <Button
              border="1px dashed var(--tt-border, #ececef)"
              borderRadius="full"
              color="var(--tt-text, #33333c)"
              fontFamily="var(--tt-font-mono, monospace)"
              fontSize="11px"
              fontWeight={500}
              height="24px"
              isDisabled={binding?.action === suggestion.action}
              key={suggestion.action}
              onClick={() => onBind(suggestion)}
              paddingX={2}
              size="xs"
              variant="unstyled"
              _hover={{ background: 'var(--tt-surface-hover, #ececee)' }}
              data-testid="component-source-suggestion"
            >
              {suggestion.action}
            </Button>
          ))}
        </Flex>
      )}
      <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
        Runs the action as you (owner-only) and hands the result to the template as <code>result</code>. The binding lives in this page’s URL — share the link, nothing is written to the component.
      </Text>
    </Flex>
  );
};

// ---------------------------------------------------------------------------

export const ComponentDetailPage = ({ docsFocus = false }: { docsFocus?: boolean }) => {
  const { key: rawKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const api = useApi();
  const lopu = useLopu();
  const user = useCurrentUser();
  const viewerId = user?.id || null;

  const key = (rawKey || '').trim();
  const designParam = searchParams.get('design') || '';
  const binding = React.useMemo(() => parseSourceBindingParams(searchParams), [searchParams]);

  const apiRef = React.useRef(api);
  apiRef.current = api;
  const lopuRef = React.useRef(lopu);
  lopuRef.current = lopu;
  const familyCacheKey = familyCacheKeyFor(viewerId, key);
  const familyCacheKeyRef = React.useRef(familyCacheKey);
  familyCacheKeyRef.current = familyCacheKey;

  // Optimistic first paint: the last family this viewer saw for the key
  // (per-user localCache line), else the code catalog for a suite part, else
  // nothing — and only then a loading state.
  const seedRef = React.useRef<'cache' | 'catalog' | null>(null);
  const seedEntries = React.useCallback((): BrowseComponentEntry[] | null => {
    const cached = familyCacheKeyRef.current ? readLocalCache<BrowseComponentEntry[]>(familyCacheKeyRef.current) : null;
    if (Array.isArray(cached) && cached.length) {
      seedRef.current = 'cache';
      return cached;
    }
    const catalog = catalogEntriesFor(key);
    seedRef.current = catalog.length ? 'catalog' : null;
    return catalog.length ? catalog : null;
  }, [key]);
  const [entries, setEntries] = React.useState<BrowseComponentEntry[] | null>(seedEntries);
  const [notFound, setNotFound] = React.useState(false);
  const requestSeqRef = React.useRef(0);

  const loadFamily = React.useCallback(async () => {
    const seq = ++requestSeqRef.current;
    // the reserved shareId form (component-<slug>) resolves through its
    // stripped componentKey first; a familyKey / componentKey resolves as-is
    const candidates = [...new Set([slugOfKey(key), key])].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const resp = (await apiRef.current.v1.components.browse({ family: candidate })) as BrowseComponentsResponse;
        if (seq !== requestSeqRef.current) return;
        if (resp?.ok && resp.components.length) {
          setEntries(resp.components);
          setNotFound(false);
          if (familyCacheKeyRef.current) writeLocalCache(familyCacheKeyRef.current, resp.components);
          return;
        }
      } catch {
        // fall through to the next candidate
      }
    }
    if (seq !== requestSeqRef.current) return;
    // a code-catalog part the database has not seeded still renders from
    // code; a stale cache line for a thing that is gone does not
    if (seedRef.current === 'catalog') return;
    setEntries([]);
    setNotFound(true);
  }, [key]);

  const mountedKeyRef = React.useRef(key);
  React.useEffect(() => {
    if (mountedKeyRef.current !== key) {
      mountedKeyRef.current = key;
      setEntries(seedEntries());
      setNotFound(false);
    }
    loadFamily();
  }, [key, loadFamily, seedEntries]);

  const sources = React.useMemo(() => {
    const mapped = (entries || []).map(entryToCardSource).filter(Boolean) as ComponentCardSource[];
    return mapped.sort((a, b) => designRank(a.library) - designRank(b.library) || (a.id < b.id ? -1 : 1));
  }, [entries]);

  const active = React.useMemo(() => pickActiveSource(sources, { design: designParam, key, viewerId }), [sources, designParam, key, viewerId]);
  const defaultSource = React.useMemo(() => pickActiveSource(sources, { design: '', key, viewerId }), [sources, key, viewerId]);

  // ---- trust ----------------------------------------------------------------
  const { trust, suiteKey } = React.useMemo(
    () => (active ? componentTrustFor(active, viewerId, suiteKeyOfComponent) : { trust: 'stranger' as ComponentTrust, suiteKey: null }),
    [active, viewerId]
  );
  const isOwner = trust === 'owner';
  const seeded = trust === 'seeded';
  const interactive = isOwner || seeded;
  const suite = suiteByKey(suiteKey);
  const suggestions = React.useMemo(
    () => (suite && active?.componentKey ? suiteSourcesFor(suite, active.componentKey) : []),
    [suite, active?.componentKey]
  );
  const { confirm, dialog } = useActionRunConfirm({ enabled: seeded, resolveActionName });

  const [values, setValues] = React.useState<ComponentArgValues>({});
  React.useEffect(() => {
    if (active) setValues({ ...defaultsFromArgs(active.args), ...(active.savedArgs || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const docsRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (docsFocus && active && docsRef.current) {
      docsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [docsFocus, active]);

  const onArgChange = React.useCallback((spec: ComponentArgSpec, raw: string | boolean) => {
    setValues((prev) => ({ ...prev, [spec.name]: coerceArgValue(spec, raw) }));
  }, []);

  // ---- install (the p.tsx precedent) ---------------------------------------
  // The post-install hand-off is deferred so the "installed ✨" toast is
  // readable before the page re-resolves. That timer OUTLIVES this component
  // if the viewer navigates away inside the delay, so it is held in a ref and
  // unmount — or a second install — cancels the pending hand-off.
  const handoffRef = React.useRef<number | null>(null);
  const scheduleHandoff = React.useCallback((run: () => void, delayMs: number) => {
    if (handoffRef.current !== null) window.clearTimeout(handoffRef.current);
    handoffRef.current = window.setTimeout(() => {
      handoffRef.current = null;
      run();
    }, delayMs);
  }, []);
  React.useEffect(
    () => () => {
      if (handoffRef.current !== null) {
        window.clearTimeout(handoffRef.current);
        handoffRef.current = null;
      }
    },
    []
  );
  // after an install the page offers the viewer's copy instead of leaving
  // the catalog: a Link, so the component page stays where they were
  const [installedHref, setInstalledHref] = React.useState<string | null>(null);

  // Install the suite for the viewer. App suites go through the one-request
  // idempotent server install (every page keeps its key, so /p/<key> now
  // serves the viewer's own copy); the demo suites keep the part-by-part
  // client install and open the personal copy by id.
  const installForViewer = React.useCallback(
    async (candidate: string): Promise<{ href: string | null } | null> => {
      const target = ALL_SUITES.find((entry) => entry.key === candidate) || null;
      if (!target) return null;
      if (!user?.id) {
        lopuRef.current({ title: 'Sign in to install this 🗝️', description: 'Installing it makes the programs — and the data — yours.', status: 'info' });
        navigate('/login');
        return null;
      }
      lopuRef.current({ title: `Installing ${target.emoji} ${target.title}…`, description: 'Your own schemas, controls, actions, and pages.', status: 'info', duration: 4000 });
      if (target.app) {
        const installed = await installSuiteOnServer(target.key);
        const href = `/p/${encodeURIComponent(installed.entryPageKey)}`;
        lopuRef.current({
          title: `${target.emoji} ${target.title} installed ✨`,
          description: `${installed.created} things created · ${installed.updated} refreshed — this component now runs your own programs.`,
          status: 'success',
          duration: 6000,
          link: { label: 'Open your copy', href }
        });
        return { href };
      }
      const installed = await installSuite((payload) => apiRef.current.v1.things.create(payload), target, { seeded: true });
      const href = `/p/${encodeURIComponent(installed.pageId)}`;
      lopuRef.current({
        title: `${target.emoji} ${target.title} installed ✨`,
        description: 'This component now runs your own programs.',
        status: 'success',
        duration: 6000,
        link: { label: 'Open your copy', href }
      });
      return { href };
    },
    [navigate, user?.id]
  );

  // a seeded suite control the viewer has no program for: install the suite
  // (their own schemas/controls/actions/data/page), let the click re-run,
  // then re-resolve the family so their own twin fronts the page
  const onUnowned = React.useCallback<TtActionUnownedHandler>(
    async (action: string): Promise<boolean> => {
      const candidate = suiteKeyFromActionKey(action, ALL_SUITES) || suiteKey;
      if (!candidate) return false;
      try {
        const outcome = await installForViewer(candidate);
        if (!outcome) return false;
        scheduleHandoff(() => {
          setInstalledHref(outcome.href);
          loadFamily();
        }, 1200);
        return true;
      } catch (err: any) {
        lopuRef.current({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
        return false;
      }
    },
    [installForViewer, loadFamily, scheduleHandoff, suiteKey]
  );

  const onInstall = React.useCallback(async (): Promise<boolean> => {
    if (!suiteKey) return false;
    try {
      const outcome = await installForViewer(suiteKey);
      if (!outcome) return false;
      setInstalledHref(outcome.href);
      loadFamily();
      return true;
    } catch (err: any) {
      lopuRef.current({ title: err?.error || 'Couldn’t install — try again 🌈', status: 'error' });
      return false;
    }
  }, [installForViewer, loadFamily, suiteKey]);

  // ---- URL state -----------------------------------------------------------
  const pickDesign = (source: ComponentCardSource) => {
    const next = new URLSearchParams(searchParams);
    const sameLibrary = sources.filter((candidate) => candidate.library === source.library);
    if (source.id === defaultSource?.id) next.delete('design');
    else next.set('design', sameLibrary.length > 1 ? source.id : source.library);
    setSearchParams(next, { replace: true });
  };

  const bindSource = React.useCallback(
    (next: ThingSourceBinding | null) => {
      setSearchParams(sourceBindingToParams(searchParams, next), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const saveVersion = async () => {
    if (!active) return;
    if (!user) {
      lopuRef.current({ title: 'Sign in to save component versions ✨', status: 'info', duration: 6000 });
      return;
    }
    const savedArgs: Record<string, string | number | boolean> = {};
    for (const spec of active.args) {
      const value = values[spec.name];
      if (value !== undefined) savedArgs[spec.name] = value;
    }
    try {
      const resp: any = await apiRef.current.v1.things.create({
        thingtime: ['component'],
        crystal: {
          name: `${active.name} v${(active.entry.usageCount || 0) + 2}`,
          description: active.description,
          library: active.library,
          category: active.category,
          ...(active.componentKey ? { componentKey: active.componentKey } : {}),
          ...(active.familyKey ? { familyKey: active.familyKey } : {}),
          version: (active.entry.usageCount || 0) + 2,
          args: active.args,
          savedArgs,
          render: active.render,
          ...(active.previewBg ? { previewBg: active.previewBg } : {}),
          forkOf: active.id
        },
        acl: [ACL_OWNER]
      });
      if (!resp?.ok) throw resp;
      lopuRef.current({ title: 'Saved a version to your Things ✨', description: 'Your copy fronts this page now — its controls run as you.', status: 'success' });
      // the viewer's new copy joins the family and fronts the page (owner → live)
      loadFamily();
    } catch (err: any) {
      lopuRef.current({ title: err?.error || 'Version didn’t save — try again 🌈', status: 'error' });
    }
  };

  const copyLink = (suffix = '') => {
    const query = searchParams.toString();
    const url = `${window.location.origin}/components/${encodeURIComponent(key)}${suffix}${query ? `?${query}` : ''}`;
    navigator.clipboard?.writeText(url).then(
      () => lopuRef.current({ title: 'Link copied 🔗', status: 'success', duration: 2500 }),
      () => lopuRef.current({ title: url, status: 'info', duration: 8000 })
    );
  };

  const resolved = React.useMemo(
    () => (active ? resolveTemplate(active.render, values) : null),
    [active, values]
  );
  const previewBackground =
    active?.previewBg && isSafeCssText(active.previewBg) ? active.previewBg : 'var(--tt-surface, #fafafb)';
  const systemFields = React.useMemo(systemThingFields, []);
  const authorHandle = active?.entry.author?.username ? `@${active.entry.author.username}` : 'their author';
  const ownLabel = (source: ComponentCardSource) => (!!viewerId && source.entry.author?.id === viewerId ? ' · yours' : '');

  return (
    <Flex background="var(--tt-surface, #fafafb)" justifyContent="center" minHeight="100vh" width="100%">
      <Flex direction="column" gap={5} maxWidth="860px" minWidth={0} pb={24} paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 36px)" px={4} width="100%">
        <Flex align="center" gap={2}>
          <Button as={Link} leftIcon={<ArrowLeft size={14} />} size="xs" to="/components" variant="ghost">
            Components
          </Button>
          <Box flex={1} />
          <Button leftIcon={<LinkIcon size={13} />} onClick={() => copyLink()} size="xs" variant="ghost">
            Copy link
          </Button>
        </Flex>

        {!active && !notFound && (
          <Box color="var(--tt-muted, #9a9aa6)" padding={10} textAlign="center">
            Loading component…
          </Box>
        )}

        {notFound && (
          <Box
            border="1px dashed var(--tt-border, #ececef)"
            borderRadius="var(--tt-radius-lg, 16px)"
            color="var(--tt-muted, #9a9aa6)"
            padding={10}
            textAlign="center"
          >
            No component answers to “{key}” — browse the catalog instead 🌈
          </Box>
        )}

        {active && (
          <>
            <Flex align="baseline" gap={3} wrap="wrap">
              <Text color="var(--tt-ink, #16161a)" fontSize="2xl" fontWeight={800}>
                {active.name}
              </Text>
              <Badge
                background="var(--tt-surface-alt, #f5f5f7)"
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="full"
                color="var(--tt-muted, #9a9aa6)"
                fontSize="11px"
                paddingX={2}
                textTransform="none"
              >
                {COMPONENT_LIBRARY_LABELS[active.library] || active.library}
              </Badge>
              <Badge background="transparent" color="var(--tt-faint, #b6b6c0)" fontSize="11px" textTransform="none">
                {isOwner ? '🌱 Yours' : active.origin === 'platform' ? '🏛 Platform' : `🌱 ${authorHandle}`}
              </Badge>
              <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px" fontFamily="var(--tt-font-mono, monospace)" wordBreak="break-all">
                {active.familyKey || active.componentKey || active.id} · {active.category}
              </Text>
            </Flex>

            {active.description && (
              <Text color="var(--tt-text, #33333c)" fontSize="sm" lineHeight="1.6">
                {active.description}
              </Text>
            )}

            {active.tags.length > 0 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                {[...active.tags].sort((a, b) => Number(isAttributionTag(b)) - Number(isAttributionTag(a))).map((tag) => {
                  const attribution = isAttributionTag(tag);
                  return (
                    <Badge
                      background={attribution ? 'var(--tt-surface-alt, #f5f5f7)' : 'transparent'}
                      border="1px solid var(--tt-border, #ececef)"
                      borderRadius="full"
                      color={attribution ? 'var(--tt-ink, #16161a)' : 'var(--tt-muted, #9a9aa6)'}
                      fontSize="10px"
                      fontWeight={attribution ? 600 : 400}
                      key={tag}
                      paddingX={2}
                      textTransform="none"
                    >
                      {attribution ? `✨ ${tag}` : tag}
                    </Badge>
                  );
                })}
              </Flex>
            )}

            {sources.length > 1 && (
              <Flex align="center" gap={1.5} wrap="wrap">
                <Text {...monoLabel}>designs ({sources.length})</Text>
                {sources.map((source) => {
                  const activeDesign = source.id === active.id;
                  return (
                    <Button
                      background={activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-card, #ffffff)'}
                      border="1px solid var(--tt-border, #ececef)"
                      borderRadius="full"
                      color={activeDesign ? 'var(--tt-card, #ffffff)' : 'var(--tt-text, #33333c)'}
                      fontSize="11px"
                      fontWeight={600}
                      height="26px"
                      key={source.id}
                      onClick={() => pickDesign(source)}
                      paddingX={3}
                      size="xs"
                      variant="unstyled"
                      _hover={{ background: activeDesign ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-hover, #ececee)' }}
                    >
                      {COMPONENT_LIBRARY_LABELS[source.library] || source.library}
                      {ownLabel(source)}
                    </Button>
                  );
                })}
              </Flex>
            )}

            {/* ------------------------------ live ------------------------------ */}
            <Flex direction="column" gap={2}>
              <Flex align="center" gap={2} wrap="wrap">
                <Text {...monoLabel}>live</Text>
                <Badge
                  background={interactive ? 'var(--tt-ink, #16161a)' : 'var(--tt-surface-alt, #f5f5f7)'}
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="full"
                  color={interactive ? 'var(--tt-card, #ffffff)' : 'var(--tt-muted, #9a9aa6)'}
                  fontSize="10px"
                  paddingX={2}
                  textTransform="none"
                  data-testid="component-trust"
                  data-trust={trust}
                >
                  {TRUST_LABELS[trust]}
                </Badge>
                {seeded && (
                  <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                    asks before each program runs · controls run your own actions{suite ? ` · installs ${suite.emoji} ${suite.title} when you have none` : ''}
                  </Text>
                )}
                <Box flex={1} />
                {installedHref && (
                  <Button as={Link} colorScheme="pink" size="xs" to={installedHref} data-testid="component-open-copy">
                    Open your copy →
                  </Button>
                )}
              </Flex>
              {!user && interactive && (
                <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" data-testid="component-signin-hint">
                  🗝️{' '}
                  <Box as={Link} color="var(--tt-link, #4c7dff)" textDecoration="underline" to="/login">
                    Sign in
                  </Box>{' '}
                  to run controls — they run as you, on your own things.
                </Text>
              )}
              <WebpageRuntimeProvider
                onInstall={seeded ? onInstall : undefined}
                pageId={active.id}
                pageKey={null}
                source={isOwner ? 'user' : seeded ? 'system' : null}
                suiteKey={suiteKey}
              >
                <LivePane
                  binding={binding}
                  confirm={seeded ? confirm : undefined}
                  interactive={interactive}
                  key={active.id}
                  onUnowned={seeded ? onUnowned : undefined}
                  source={active}
                  values={values}
                />
              </WebpageRuntimeProvider>
            </Flex>

            {/* ---------------------------- preview ---------------------------- */}
            <Flex direction="column" gap={2}>
              <Flex align="center" gap={2}>
                <Text {...monoLabel}>preview</Text>
                <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                  args only · inert
                </Text>
              </Flex>
              <Center
                background={previewBackground}
                border="1px solid var(--tt-border, #ececef)"
                borderRadius="var(--tt-radius-lg, 16px)"
                minHeight="120px"
                overflow="hidden"
                padding={{ base: 4, md: 8 }}
                data-testid="component-preview"
              >
                <Box maxWidth="100%" sx={{ '& > *': { maxWidth: '100%' } }}>
                  {isChakraThingNode(resolved) ? (
                    <ChakraThingRenderer node={resolved as ChakraThingNode} />
                  ) : (
                    <HtmlThingRenderer node={resolved as HtmlThingNode} />
                  )}
                </Box>
              </Center>
            </Flex>

            {/* ----------------------------- tester ---------------------------- */}
            <Flex
              background="var(--tt-card, #ffffff)"
              border="1px solid var(--tt-border, #ececef)"
              borderRadius="var(--tt-radius-md, 12px)"
              direction="column"
              gap={3}
              minWidth={0}
              padding={4}
            >
              {active.args.length > 0 && (
                <Flex direction="column" gap={2}>
                  <Text {...monoLabel}>args tester</Text>
                  {active.args.map((spec) => (
                    <ArgRow key={spec.name} onChange={onArgChange} spec={spec} value={values[spec.name]} />
                  ))}
                  <Button
                    alignSelf="flex-start"
                    color="var(--tt-muted, #9a9aa6)"
                    fontSize="11px"
                    onClick={() => setValues(defaultsFromArgs(active.args))}
                    size="xs"
                    variant="link"
                  >
                    reset to defaults
                  </Button>
                </Flex>
              )}
              <SourceControl binding={binding} onBind={bindSource} suggestions={suggestions} />
              <Flex align="center" gap={2} wrap="wrap">
                {trust === 'stranger' && (
                  <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px" data-testid="component-stranger-hint">
                    🔒 Controls belong to {authorHandle} — save a version to run them as yours
                  </Text>
                )}
                <Box flex={1} />
                <Button colorScheme="pink" onClick={saveVersion} size="xs" data-testid="component-save-version">
                  Save version to my Things
                </Button>
              </Flex>
            </Flex>

            {/* ------------------------------ docs ------------------------------ */}
            <Flex direction="column" gap={3} ref={docsRef}>
              <Text color="var(--tt-ink, #16161a)" fontSize="lg" fontWeight={700} paddingTop={2}>
                Docs
              </Text>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>deep links</Text>
                <Flex direction="column" gap={1}>
                  {[
                    { label: 'component page', suffix: '' },
                    { label: 'docs page', suffix: '/docs' }
                  ].map((link) => (
                    <Flex align="center" gap={2} key={link.suffix} minWidth={0}>
                      <Text color="var(--tt-text, #33333c)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" wordBreak="break-all">
                        /components/{key}
                        {link.suffix}
                      </Text>
                      <Button onClick={() => copyLink(link.suffix)} size="xs" variant="ghost" color="var(--tt-muted, #9a9aa6)">
                        copy
                      </Button>
                    </Flex>
                  ))}
                  <Text color="var(--tt-faint, #b6b6c0)" fontSize="11px">
                    add <code>?source=&lt;actionKey&gt;</code> (+ <code>&amp;refresh=manual|interval&amp;interval=&lt;ms&gt;&amp;inputs=&lt;json&gt;</code>) to share the page bound to a data source
                  </Text>
                </Flex>
              </Flex>

              {active.args.length > 0 && (
                <Flex direction="column" gap={1.5}>
                  <Text {...monoLabel}>args reference</Text>
                  <Flex direction="column" gap={1}>
                    {active.args.map((spec) => (
                      <Flex align="baseline" gap={2} key={spec.name} wrap="wrap">
                        <Text color="var(--tt-ink, #16161a)" fontFamily="var(--tt-font-mono, monospace)" fontSize="12px" fontWeight={600}>
                          {spec.name}
                        </Text>
                        <Text color="var(--tt-muted, #9a9aa6)" fontSize="12px">
                          {describeArg(spec)}
                          {spec.default !== undefined ? ` · default ${JSON.stringify(spec.default)}` : ''}
                        </Text>
                        {spec.description && (
                          <Text color="var(--tt-faint, #b6b6c0)" fontSize="12px">
                            {spec.description}
                          </Text>
                        )}
                      </Flex>
                    ))}
                  </Flex>
                </Flex>
              )}

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel} title="System props stamped by Thingtime">
                  thingtime adds
                </Text>
                <Flex gap={1.5} wrap="wrap">
                  {systemFields.map((field) => (
                    <Text color="var(--tt-muted, #9a9aa6)" fontFamily="var(--tt-font-mono, monospace)" fontSize="11px" key={field.name}>
                      {field.name}: {describeSchemaField(field)}
                    </Text>
                  ))}
                </Flex>
              </Flex>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>create via API</Text>
                <Box
                  as="pre"
                  background="var(--tt-card, #ffffff)"
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="var(--tt-radius-xs, 7px)"
                  color="var(--tt-text, #33333c)"
                  fontFamily="var(--tt-font-mono, monospace)"
                  fontSize="11px"
                  overflow="auto"
                  padding={3}
                >
                  {`POST /api/v1/things\n${JSON.stringify(
                    {
                      thingtime: ['component'],
                      crystal: {
                        name: active.name,
                        library: active.library,
                        category: active.category,
                        ...(active.componentKey ? { componentKey: active.componentKey } : {}),
                        ...(active.familyKey ? { familyKey: active.familyKey } : {}),
                        args: '…',
                        render: '…'
                      }
                    },
                    null,
                    2
                  )}`}
                </Box>
              </Flex>

              <Flex direction="column" gap={1.5}>
                <Text {...monoLabel}>definition</Text>
                <Box
                  as="pre"
                  background="var(--tt-card, #ffffff)"
                  border="1px solid var(--tt-border, #ececef)"
                  borderRadius="var(--tt-radius-xs, 7px)"
                  color="var(--tt-text, #33333c)"
                  fontFamily="var(--tt-font-mono, monospace)"
                  fontSize="11px"
                  maxHeight="420px"
                  overflow="auto"
                  padding={3}
                >
                  {JSON.stringify(
                    {
                      name: active.name,
                      library: active.library,
                      category: active.category,
                      componentKey: active.componentKey,
                      familyKey: active.familyKey,
                      version: active.version,
                      args: active.args,
                      ...(active.savedArgs ? { savedArgs: active.savedArgs } : {}),
                      render: active.render
                    },
                    null,
                    2
                  )}
                </Box>
              </Flex>
            </Flex>
          </>
        )}
      </Flex>
      {dialog}
    </Flex>
  );
};

// Local slim arg input row (the browse card has its own richer variant).
const ArgRow = ({
  spec,
  value,
  onChange
}: {
  spec: ComponentArgSpec;
  value: string | number | boolean | undefined;
  onChange: (spec: ComponentArgSpec, raw: string | boolean) => void;
}) => (
  <Flex align="center" gap={2}>
    <Text
      color="var(--tt-muted, #9a9aa6)"
      fontFamily="var(--tt-font-mono, monospace)"
      fontSize="11px"
      minWidth="90px"
      noOfLines={1}
      title={spec.description || spec.name}
    >
      {spec.label || spec.name}
    </Text>
    {spec.type === 'boolean' ? (
      <input checked={!!value} onChange={(event) => onChange(spec, event.target.checked)} type="checkbox" />
    ) : spec.type === 'enum' ? (
      <select
        onChange={(event) => onChange(spec, event.target.value)}
        style={{ border: '1px solid var(--tt-border, #ececef)', borderRadius: 7, fontSize: 13, padding: '4px 8px' }}
        value={String(value ?? '')}
      >
        {(spec.values || []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <input
        max={spec.max}
        min={spec.min}
        maxLength={spec.maxLength}
        onChange={(event) => onChange(spec, event.target.value)}
        style={{
          border: '1px solid var(--tt-border, #ececef)',
          borderRadius: 7,
          flex: 1,
          fontSize: 13,
          minWidth: 0,
          padding: '4px 8px'
        }}
        type={spec.type === 'number' ? 'number' : spec.type === 'color' ? 'color' : 'text'}
        value={String(value ?? '')}
      />
    )}
  </Flex>
);
