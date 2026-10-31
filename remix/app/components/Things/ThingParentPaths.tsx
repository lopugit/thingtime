import React from 'react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { rootIdentity } from '~/utils/rootIdentity';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { parentPathPage, scanParentReferenceBatch, type ParentIndex, type ParentPathThing, type ParentPathSegment, type ParentPathWork } from './thingParentPathsCore';
const button = (id: string, label: string, operation: string): WebpageBlock => ({ id, type: 'element', tag: 'button', text: label, props: { type: 'button', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation } }, css: { 'min-height': '44px', padding: '8px 12px', border: '1px solid var(--tt-border, #d4d4d8)', 'border-radius': '8px' } });
export const parentPathBlocks: WebpageBlock[] = [{ id: 'parent-paths', type: 'element', tag: 'section', props: { 'aria-label': 'Referenced by parent paths' }, css: { display: 'grid', gap: '12px', padding: '16px', border: '1px solid var(--tt-border, #e4e4e7)', 'border-radius': '12px', 'min-width': '0' }, children: [
  { id: 'parent-path-heading', type: 'element', tag: 'h2', text: 'Referenced by · Parent paths' },
  { id: 'parent-path-description', type: 'element', tag: 'p', text: 'Generate additional parent paths from structured references in your accessible Things. Includes file content, post Thing collections, webpage media and folder/parent/target lineage. Other accounts’ reverse references, arbitrary text and unsupported reference kinds are outside this scan.' },
  { id: 'parent-path-status', type: 'element', tag: 'p', text: '{parentPaths.status}', props: { role: 'status', 'aria-live': 'polite' } },
  { id: 'parent-path-actions', type: 'element', tag: 'div', css: { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }, children: [button('parent-path-scan', 'Scan / continue parent references', 'scan'), button('parent-path-more', 'More parent paths', 'more'), button('parent-path-cancel', 'Cancel scan', 'cancel')] },
  { id: 'parent-path-results', type: 'collection', props: { itemsPath: 'parentPaths.paths', label: 'Generated parent paths', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '{parentPaths.empty}' }, children: [
    { id: 'parent-path-entry', type: 'element', tag: 'article', css: { padding: '12px', border: '1px solid var(--tt-border, #e4e4e7)', 'border-radius': '8px', 'min-width': '0' }, children: [
      { id: 'parent-path-label', type: 'element', tag: 'p', text: '{item.label}' },
      { id: 'parent-path-segments', type: 'collection', props: { itemsPath: 'item.segments', label: 'Path segments', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '' }, children: [
        { id: 'parent-path-segment', type: 'element', tag: 'span', css: { display: 'inline-flex', gap: '8px', 'align-items': 'center', 'min-width': '0' }, children: [
          { id: 'parent-path-separator', type: 'element', tag: 'span', text: '{item.separator}', props: { 'aria-hidden': true } },
          { id: 'parent-path-link', type: 'element', tag: 'a', text: '{item.name}', props: { href: '{item.href}' }, css: { 'min-height': '44px', display: 'inline-flex', 'align-items': 'center', 'overflow-wrap': 'anywhere' } }
        ] }
      ] }
    ] }
  ] }
] }];
export function ThingParentPaths({ thing }: { thing: ParentPathThing }) {
  const user = useCurrentUser(), plane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const scope = JSON.stringify([user?.id, plane, identity.generation, thing.id]);
  return <ParentPathsSession key={scope} thing={thing} scope={scope} ownerId={user?.id} plane={plane} />;
}
function ParentPathsSession({ thing, scope, ownerId, plane }: { thing: ParentPathThing; scope: string; ownerId?: string; plane: ReturnType<typeof useDataPlane> }) {
  const api = useApi(), apiRef = React.useRef(api); apiRef.current = api;
  const work = React.useRef<{ index: ParentIndex; cursor?: string; complete: boolean; scanned: number; pending: ParentPathWork; started: boolean }>({ index: new Map(), complete: false, scanned: 0, pending: [], started: false });
  const active = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => active.current?.abort(), []);
  const [paths, setPaths] = React.useState<ParentPathSegment[][]>([]);
  const [status, setStatus] = React.useState('Additional references have not been scanned. Known direct file locations are shown separately.');
  const run = async (scan: boolean) => {
    if (active.current && !active.current.signal.aborted) return;
    if (!ownerId) { setStatus('Sign in to scan references in your own Things.'); return; }
    if (!scan && !work.current.started) { setStatus('Scan references before requesting additional paths.'); return; }
    if (!scan && !work.current.pending.length) { setStatus('No further path pages in the current scan. Continue the reference scan or rescan after changes.'); return; }
    const controller = new AbortController(); active.current = controller;
    const state = work.current;
    const cache = new Map<string, Promise<ParentPathThing | null>>();
    const read = (id: string) => {
      if (!cache.has(id)) cache.set(id, apiRef.current.v1.things.get({ id }, { signal: controller.signal, expectedActor: ownerId, expectedDataPlane: plane }).then(r => { controller.signal.throwIfAborted(); return r?.thing ?? null; }).catch(error => { controller.signal.throwIfAborted(); if (error?.status === 403 || error?.status === 404) return null; throw error; }));
      return cache.get(id)!;
    };
    try {
      if (scan) {
        if (state.complete) { state.index = new Map(); state.scanned = 0; state.cursor = undefined; }
        setStatus(`Scanning the next batch of up to 500 Things… ${state.scanned} previously scanned.`);
        const batch = await scanParentReferenceBatch(cursor => apiRef.current.v1.things.list({ cursor, limit: 50 }, { signal: controller.signal, expectedActor: ownerId, expectedDataPlane: plane }), state.index, state.cursor, 10, (count, cursor, complete) => { state.scanned += count; state.cursor = cursor; state.complete = complete; });
        controller.signal.throwIfAborted();
        state.cursor = batch.cursor; state.complete = batch.complete; state.started = true;
        state.pending = [{ ids: [thing.id], segments: [] }];
      }
      const page = await parentPathPage(thing.id, state.index, read, state.pending);
      controller.signal.throwIfAborted(); state.pending = page.pending;
      setPaths(page.paths);
      setStatus(`${state.scanned} Things scanned; ${state.complete ? 'owner-library scan complete' : 'scan incomplete — continue to discover more references'}. ${page.paths.length} paths on this page${state.pending.length ? '; more paths available' : ''}. ${page.cycles ? 'Cyclic relationships skipped. ' : ''}${page.unavailable ? 'Some relationships are unavailable with current access. ' : ''}Scope: your accessible library and viewable direct ancestors.`);
    } catch (error) { if (!controller.signal.aborted) setStatus('The scan stopped before completion. Existing results remain; continue to retry.'); }
    finally { if (active.current === controller) active.current = null; }
  };
  return <SettingsDocumentHost documentKey="thing-parent-paths" defaultDocument={parentPathBlocks} scopeKey={scope} title="Referenced by paths">
    {({ blocks, chrome, editing }) => <TransientBlockHost enabled={!editing} scopeKey={scope} scope={{ parentPaths: { status, empty: work.current.started ? 'No complete additional parent paths on this page. An incomplete scan does not prove there are no references.' : 'Choose Scan to query additional structured references.', paths: paths.map((segments, index) => ({ label: `Parent path ${index + 1}`, segments: segments.map((segment, i) => ({ ...segment, separator: i ? '/' : '' })) })) } }} actions={{ scan: () => run(true), more: () => run(false), cancel: () => { active.current?.abort(); active.current = null; setStatus('Scan cancelled. Retained scan progress can be continued.'); } }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
  </SettingsDocumentHost>;
}
