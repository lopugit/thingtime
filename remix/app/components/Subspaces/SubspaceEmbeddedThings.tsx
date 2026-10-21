import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { subscribeBackgroundRefresh } from '~/hooks/backgroundRefresh';
import { subspaceEmbedSearchResults } from './subspaceEmbedSearch';
import { PostInteractiveThing } from '../Feed/PostInteractiveThing';
import { thingDisplayName, thingLink, type ThingsThing } from '../Things/thingsCore';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import type { WebpageBlock } from '../Builder/webpageBlocks';

type EmbedRegion = 'sidebar' | 'feed';
type Embed = { id: string; thingId: string; region: EmbedRegion; order: number; thing: ThingsThing | null };
const eventName = 'tt-subspace-embeds-changed';
const el = (id: string, tag: string, text = '', props: Record<string, unknown> = {}, children?: WebpageBlock[], css?: Record<string, string>): WebpageBlock =>
  ({ id, type: 'element', tag, text, props, ...(children ? { children } : {}), ...(css ? { css } : {}) } as WebpageBlock);
const action = (operation: string, inputs: Record<string, string> = {}) => ({ 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation, ...inputs } });
const button = (id: string, text: string, operation: string, inputs: Record<string, string> = {}) => el(id, 'button', text,
  { type: 'button', disabled: '{result.busy}', ...action(operation, inputs) }, undefined,
  { padding: '6px 10px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', background: 'var(--tt-card, white)', color: 'inherit', cursor: 'pointer', 'white-space': 'normal' });
const row = (id: string, children: WebpageBlock[]) => el(id, 'div', '', {}, children, { display: 'flex', gap: '8px', 'flex-wrap': 'wrap', 'align-items': 'center', 'min-width': '0' });
const editorBlocks = (region: EmbedRegion): WebpageBlock[] => [el('embed-editor', 'fieldset', '', {}, [
  el('embed-title', 'legend', '{result.title}'),
  el('embed-help', 'p', 'Search and select any Thing you can view, or paste its exact Thing ID. Each visitor still needs access to read it.', {}, undefined, { 'font-size': '13px', 'white-space': 'normal', 'overflow-wrap': 'anywhere' }),
  row('embed-search-row', [el('embed-search-label', 'label', 'Search Things', { htmlFor: `${region}-embed-search` }), el('embed-search', 'input', '', { id: `${region}-embed-search`, name: 'thing-search', 'aria-label': 'Search Things to embed', placeholder: 'Search accessible Things…', ...action('embed.search') }, undefined,
    { flex: '1', 'min-width': '140px', padding: '8px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)' })]),
  { id: 'embed-search-results', type: 'collection', props: { itemsPath: 'result.searchResults', size: 'all', transparent: true, label: 'Search results' }, children: [row('embed-search-result', [
    el('embed-search-name', 'span', '{item.name}', {}, undefined, { flex: '1', 'min-width': '120px', 'overflow-wrap': 'anywhere' }),
    button('embed-select', 'Add this Thing', 'embed.select', { thingId: '{item.id}' })
  ])] } as WebpageBlock,
  el('embed-search-status', 'p', '{result.searchStatus}', { role: 'status' }, undefined, { 'font-size': '13px', 'white-space': 'normal' }),
  { id: 'embed-search-more-condition', type: 'condition', condition: { arg: 'result.searchHasMore', equals: true }, children: [button('embed-search-more', 'Load more search results', 'embed.search-more')] } as WebpageBlock,
  row('embed-add-row', [el('embed-id-label', 'label', 'Thing ID', { htmlFor: `${region}-embed-thing-id` }), el('embed-thing-id', 'input', '', { id: `${region}-embed-thing-id`, name: 'thing-id', 'aria-label': 'Thing ID', placeholder: 'Paste a Thing ID', disabled: '{result.busy}' }, undefined,
    { flex: '1', 'min-width': '140px', padding: '8px', border: '1px solid var(--tt-border, #ddd)', 'border-radius': '8px', color: 'inherit', background: 'var(--tt-card, white)' }), button('embed-add', 'Add Thing', 'embed.add')]),
  { id: 'embed-rows', type: 'collection', props: { itemsPath: 'result.embeds', size: 'all', transparent: true, label: 'Embedded Things' }, children: [row('embed-row', [
    el('embed-name', 'a', '{item.name}', { href: '{item.href}' }, undefined, { flex: '1', 'min-width': '120px', 'overflow-wrap': 'anywhere' }),
    button('embed-up', 'Move up', 'embed.move', { embedId: '{item.id}', direction: 'up' }),
    button('embed-down', 'Move down', 'embed.move', { embedId: '{item.id}', direction: 'down' }),
    button('embed-remove', 'Remove', 'embed.remove', { embedId: '{item.id}' })
  ])] } as WebpageBlock,
  el('embed-notice', 'p', '{result.notice}', { role: 'status' }, undefined, { 'font-size': '13px', 'white-space': 'normal' }),
  { id: 'embed-more-condition', type: 'condition', condition: { arg: 'result.hasMore', equals: true }, children: [button('embed-more', 'Load more embedded Things', 'embed.more')] } as WebpageBlock
], { border: '1px solid var(--tt-border, #ddd)', 'border-radius': '12px', padding: '16px', 'min-width': '0' })];

function useEmbeds(subspaceId: string, region: EmbedRegion, active = true) {
  const refreshId = React.useId();
  const api = useApi();
  const apiRef = React.useRef(api); apiRef.current = api;
  const [embeds, setEmbeds] = React.useState<Embed[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const sequence = React.useRef(0);
  const pending = React.useRef(false);
  const resetQueued = React.useRef(false);
  const mounted = React.useRef(true);
  const activeRef = React.useRef(active); activeRef.current = active;
  const reloadRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    mounted.current = true;
    // Operation state, not a DOM ref; StrictMode may remount this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { mounted.current = false; };
  }, []);
  const load = React.useCallback(async (next?: string | null) => {
    if (pending.current) { if (!next) resetQueued.current = true; return; }
    pending.current = true;
    resetQueued.current = false;
    const generation = ++sequence.current;
    setLoading(true);
    try {
      const payload = await apiRef.current.v1.subspaces.embeds({ id: subspaceId, region, cursor: next || undefined });
      if (generation !== sequence.current) return;
      setEmbeds(previous => next ? [...previous, ...payload.embeds.filter((entry: Embed) => !previous.some(row => row.id === entry.id))] : payload.embeds);
      setCursor(payload.nextCursor || null); setError('');
    } catch (failure: any) {
      if (generation !== sequence.current) return;
      if ([401, 403, 404].includes(Number(failure?.status))) { setEmbeds([]); setCursor(null); }
      setError(failure?.error || failure?.message || 'Could not load embedded Things.');
    } finally {
      pending.current = false;
      if (generation === sequence.current) setLoading(false);
      // Effect remounts/focus refreshes that coalesced with an older request
      // must get their own current projection as soon as it settles.
      if (resetQueued.current && mounted.current && activeRef.current) {
        resetQueued.current = false;
        reloadRef.current();
      }
    }
  }, [subspaceId, region]);
  reloadRef.current = () => { void load(); };
  React.useEffect(() => {
    if (!active) return;
    // A refresh replaces the complete loaded window: old appended private
    // references cannot survive a fresh membership/ACL projection.
    const unsubscribe = subscribeBackgroundRefresh(`subspace-embeds:${subspaceId}:${region}:${refreshId}`, () => load(), 15_000);
    const changed = (event: Event) => { if ((event as CustomEvent).detail === subspaceId) void load(); };
    window.addEventListener(eventName, changed);
    // sequence is an operation fence, never a DOM ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; unsubscribe(); window.removeEventListener(eventName, changed); };
  }, [active, load, subspaceId, region, refreshId]);
  return { embeds, cursor, error, loading, load, apiRef };
}

const DISPLAY_BLOCKS: WebpageBlock[] = [el('embed-placement', 'section', '', { 'aria-label': '{result.title}' }, [
  { id: 'embed-display-rows', type: 'collection', props: { itemsPath: 'result.embeds', size: 'all', transparent: true, label: 'Embedded Things' }, children: [el('embed-card', 'article', '', {}, [
    el('embed-card-title', 'a', '{item.name}', { href: '{item.href}' }, undefined, { display: 'block', 'font-weight': '600', 'font-size': '14px', 'margin-bottom': '8px', 'overflow-wrap': 'anywhere' }),
    el('embed-card-content', 'div', '', { 'data-tt-content-slot': 'embedded-thing' }, undefined, { 'min-width': '0' })
  ], { border: '1px solid var(--tt-border, #ececef)', 'border-radius': '12px', padding: '12px', 'min-width': '0', 'margin-bottom': '12px' })] } as WebpageBlock,
  el('embed-display-error', 'p', '{result.error}', { role: 'alert' }, undefined, { 'font-size': '13px', 'white-space': 'normal' }),
  { id: 'embed-display-more-condition', type: 'condition', condition: { arg: 'result.canLoad', equals: true }, children: [button('embed-display-more', '{result.moreLabel}', 'embed.more')] } as WebpageBlock
], { 'min-width': '0' })];

function ScopedEmbedView({ subspaceId, region, scopeKey, active }: { subspaceId: string; region: EmbedRegion; scopeKey: string; active?: boolean }) {
  const list = useEmbeds(subspaceId, region, active);
  if (!list.embeds.length && !list.error) return null;
  const scope = { result: { title: region === 'sidebar' ? 'Sidebar Things' : 'Things above posts', busy: list.loading, error: list.error, canLoad: !!list.cursor || !!list.error,
    moreLabel: list.error ? 'Retry embedded Things' : 'Load more embedded Things',
    embeds: list.embeds.map(embed => ({ ...embed, name: embed.thing ? thingDisplayName(embed.thing) : 'Unavailable Thing', href: embed.thing ? thingLink(embed.thing) : '' })) } };
  return <div data-testid={`subspace-${region}-embeds`}><SettingsDocumentHost documentKey={`subspace-display-${region}`} title="Embedded Things layout" defaultDocument={DISPLAY_BLOCKS} scopeKey={scopeKey} persistence="device">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} enabled={!editing} actions={{ 'embed.more': () => { if (!list.loading) return list.load(list.error ? undefined : list.cursor); } }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare contentSlots={{ 'embedded-thing': ({ scope: itemScope, editing: editingContent }) => {
        const rowId = (itemScope.item as { id?: unknown } | undefined)?.id;
        const item = list.embeds.find(entry => entry.id === rowId);
        // Only the already authorized current response supplies content. Layout
        // authors cannot supply a source, a private grant or another Thing id.
        return item?.thing ? editingContent ? <div>Thing content · edit the original Thing to change its fields.</div> : <PostInteractiveThing thing={item.thing} compact={region === 'sidebar'} /> : <p>This embedded Thing is unavailable or private.</p>;
      } }} />
    </TransientBlockHost>}
  </SettingsDocumentHost></div>;
}
export function SubspaceEmbeddedThings(props: { subspaceId: string; region: EmbedRegion; active?: boolean }) {
  const user = useCurrentUser(); const plane = useDataPlane();
  const scopeKey = JSON.stringify([user?.id, plane, props.subspaceId, props.region]);
  return <ScopedEmbedView key={scopeKey} scopeKey={scopeKey} {...props} />;
}

function EmbedRegionEditor({ subspaceId, region, scopeKey, active }: { subspaceId: string; region: EmbedRegion; scopeKey: string; active?: boolean }) {
  const list = useEmbeds(subspaceId, region, active);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const pendingAdd = React.useRef<{ thingId: string; requestId: string } | null>(null);
  const inFlight = React.useRef(false);
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<Array<{ id: string; name: string }>>([]);
  const [searchCursor, setSearchCursor] = React.useState<string | null>(null);
  const [searchStatus, setSearchStatus] = React.useState('');
  const searchSequence = React.useRef(0);
  const search = React.useCallback(async (cursor?: string | null) => {
    const request = ++searchSequence.current;
    setSearchStatus('Searching…');
    try {
      const payload = query.trim() ? await list.apiRef.current.v1.things.search({ q: query.trim(), cursor: cursor || undefined, limit: 30 })
        : await list.apiRef.current.v1.things.list({ folder: 'root', cursor: cursor || undefined, limit: 30 });
      if (request !== searchSequence.current) return;
      if (payload?.ok === false) throw new Error(payload.error || 'Search is unavailable.');
      const rows = subspaceEmbedSearchResults(payload);
      setSearchResults(previous => [...new Map([...(cursor ? previous : []), ...rows].map(item => [item.id, item])).values()]);
      setSearchCursor(payload.nextCursor || null); setSearchStatus(rows.length ? '' : payload.nextCursor ? 'No selectable Things on this page. Load more results or enter a search.' : 'No matching Things. Try another search or use an exact Thing ID.');
    } catch (failure: any) { if (request === searchSequence.current) setSearchStatus(failure?.error || failure?.message || 'Search is unavailable. You can still enter an exact Thing ID.'); }
  }, [query, list.apiRef]);
  React.useEffect(() => {
    setSearchResults([]); setSearchCursor(null);
    const timer = setTimeout(() => void search(), 220);
    // This ref fences network results after identity or query changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { clearTimeout(timer); searchSequence.current++; };
  }, [search]);
  const mutate = async (body: Record<string, unknown>, signal: AbortSignal) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice('');
    try {
      await list.apiRef.current.v1.subspaces.mutateEmbed({ id: subspaceId, region, ...body });
      if (signal.aborted) return;
      if (body.operation === 'add') pendingAdd.current = null;
      setNotice('Saved.');
      if (!signal.aborted) window.dispatchEvent(new CustomEvent(eventName, { detail: subspaceId }));
    } catch (failure: any) { if (!signal.aborted) setNotice(failure?.error || failure?.message || 'Could not save this change. Retry uses the same add identity.'); }
    finally { inFlight.current = false; if (!signal.aborted) setBusy(false); }
  };
  const scope = { result: { title: region === 'sidebar' ? 'Sidebar Things' : 'Things above posts', busy: busy || list.loading, hasMore: !!list.cursor, notice: notice || list.error,
    searchResults, searchHasMore: !!searchCursor, searchStatus,
    embeds: list.embeds.map(embed => ({ id: embed.id, name: embed.thing ? thingDisplayName(embed.thing) : `${embed.thingId} (unavailable or private)`, href: embed.thing ? thingLink(embed.thing) : `/thing/${encodeURIComponent(embed.thingId)}` })) } };
  return <SettingsDocumentHost documentKey={`subspace-embed-${region}`} title="Embedded Thing controls" defaultDocument={editorBlocks(region)} scopeKey={scopeKey} persistence="device">
    {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} scope={scope} enabled={!editing} actions={{
      'embed.add': ({ readField, signal }) => {
        const thingId = String(readField('thing-id') || '').trim();
        if (!thingId) { setNotice('Enter a Thing ID.'); return; }
        if (pendingAdd.current?.thingId !== thingId) pendingAdd.current = { thingId, requestId: crypto.randomUUID() };
        return mutate({ operation: 'add', ...pendingAdd.current }, signal);
      },
      'embed.search': ({ value }) => setQuery(String(value || '')),
      'embed.search-more': () => search(searchCursor),
      'embed.select': ({ inputs, signal }) => {
        const thingId = String(inputs.thingId || '');
        if (!searchResults.some(item => item.id === thingId)) return;
        if (pendingAdd.current?.thingId !== thingId) pendingAdd.current = { thingId, requestId: crypto.randomUUID() };
        return mutate({ operation: 'add', ...pendingAdd.current }, signal);
      },
      'embed.remove': ({ inputs, signal }) => mutate({ operation: 'remove', embedId: inputs.embedId }, signal),
      'embed.move': ({ inputs, signal }) => mutate({ operation: 'move', embedId: inputs.embedId, direction: inputs.direction }, signal),
      'embed.more': () => { if (!list.loading && list.cursor) return list.load(list.cursor); }
    }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare /></TransientBlockHost>}
  </SettingsDocumentHost>;
}
export function SubspaceEmbedsEditor({ subspaceId }: { subspaceId: string }) {
  const user = useCurrentUser(); const plane = useDataPlane();
  const scopeKey = JSON.stringify([typeof window === 'undefined' ? '' : window.location.origin, user?.id, plane, subspaceId]);
  return <Flex direction="column" gap={4} minW={0} key={scopeKey}>{(['sidebar', 'feed'] as const).map(region => <EmbedRegionEditor key={region} subspaceId={subspaceId} region={region} scopeKey={`${scopeKey}:${region}`} />)}</Flex>;
}
