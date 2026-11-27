import React from 'react';
import { isUnfiledAttachment } from './fileLocationCore';
import { Box, Flex } from '@chakra-ui/react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { useDataPlane } from '~/hooks/useDataPlane';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';

export const unfiledAttachmentBlocks: WebpageBlock[] = [{ id: 'unfiled-files', type: 'element', tag: 'section', css: { display: 'grid', gap: '16px', 'min-width': '0' }, children: [
  { id: 'unfiled-back', type: 'element', tag: 'a', text: 'All Things', props: { href: '/things' }, css: { 'min-height': '44px', display: 'inline-flex', 'align-items': 'center' } },
  { id: 'unfiled-heading', type: 'element', tag: 'h1', text: 'Unfiled files', css: { 'font-size': '28px', 'font-weight': '650' } },
  { id: 'unfiled-description', type: 'element', tag: 'p', text: 'Files and recordings without a published file location. Some legacy uploads have no recorded original folder. Open a file to inspect its saved location or original sync source. This is a recovery collection, not a folder on your device.' },
  { id: 'unfiled-status', type: 'element', tag: 'p', text: '{unfiled.status}', props: { role: 'status' } },
  { id: 'unfiled-load-more', type: 'element', tag: 'button', text: '{unfiled.loadLabel}', props: { type: 'button', disabled: '{unfiled.disabled}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'more' } }, css: { 'min-height': '44px', padding: '8px 12px', 'justify-self': 'start' } },
  { id: 'unfiled-list', type: 'collection', props: { itemsPath: 'unfiled.items', label: 'Unfiled files', size: 'all', hideSize: true, empty: 'No unfiled files are available.' }, children: [
    { id: 'unfiled-item', type: 'element', tag: 'article', css: { padding: '16px', border: '1px solid var(--tt-border, #e4e4e7)', 'border-radius': '12px', 'min-width': '0' }, children: [
      { id: 'unfiled-item-name', type: 'element', tag: 'a', text: '{item.name}', props: { href: '{item.href}' }, css: { display: 'inline-flex', 'min-height': '44px', 'align-items': 'center', 'overflow-wrap': 'anywhere' } },
      { id: 'unfiled-item-location', type: 'element', tag: 'p', text: 'View saved location or original sync source' }
    ] }
  ] }
] }];

export function UnfiledAttachmentsPage() {
  const api = useApi(), user = useCurrentUser(), plane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const scopeKey = JSON.stringify([user?.id, plane, identity.generation]);
  return <UnfiledAttachmentsContent key={scopeKey} scopeKey={scopeKey} api={api} ownerId={user?.id} plane={plane} />;
}
function UnfiledAttachmentsContent({ scopeKey, api, ownerId, plane }: { scopeKey: string; api: ReturnType<typeof useApi>; ownerId?: string; plane: ReturnType<typeof useDataPlane> }) {
  const [items, setItems] = React.useState<{ name: string; href: string }[]>([]);
  const [status, setStatus] = React.useState(ownerId ? 'Reading unfiled files…' : 'Sign in to browse your unfiled files.');
  const [busy, setBusy] = React.useState(false), [complete, setComplete] = React.useState(false);
  const paging = React.useRef<{ cursor?: string; seen: Set<string>; complete: boolean }>({ seen: new Set(), complete: false });
  const active = React.useRef<AbortController | null>(null);
  const apiRef = React.useRef(api); apiRef.current = api;
  const load = React.useCallback(async () => {
    if (!ownerId || paging.current.complete || (active.current && !active.current.signal.aborted)) return;
    const controller = new AbortController(); active.current = controller;
    setBusy(true);
    try {
      const result = await apiRef.current.v1.things.list({ thingtime: 'attachment', limit: 50, cursor: paging.current.cursor }, { signal: controller.signal, expectedActor: ownerId, expectedDataPlane: plane });
      controller.signal.throwIfAborted();
      const next = result.nextCursor || undefined;
      if (next && (next === paging.current.cursor || paging.current.seen.has(next))) throw Error('Repeated files cursor');
      if (next) paging.current.seen.add(next);
      paging.current.cursor = next; paging.current.complete = !next; setComplete(!next);
      setItems(previous => {
        const rows = new Map(previous.map(item => [item.href, item]));
        for (const row of result.things ?? []) if (isUnfiledAttachment(row)) rows.set(`/thing/${encodeURIComponent(row.id)}?from=things`, { name: String(row.crystal?.name || row.crystal?.title || row.id), href: `/thing/${encodeURIComponent(row.id)}?from=things` });
        return [...rows.values()];
      });
      setStatus(next ? 'Showing the loaded files. More files are available; choose Load more files.' : 'All available unfiled files and recordings are loaded.');
    } catch { if (!controller.signal.aborted) setStatus('The next page could not be loaded. Your current files remain; choose Load more files to retry.'); }
    finally { if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); } }
  }, [ownerId, plane]);
  React.useEffect(() => { void load(); return () => active.current?.abort(); }, [load]);
  return <Flex justify="center" minHeight="100vh" width="100%" background="var(--tt-surface, #fafafb)" paddingTop="calc(var(--thingtime-safe-area-top, 0px) + var(--tt-nav-clearance, 54px) + 24px)" paddingBottom={12}>
    <Box width="100%" maxWidth="1100px" padding={{ base: 4, md: 6 }} minWidth={0}>
      <SettingsDocumentHost documentKey="unfiled-attachments" defaultDocument={unfiledAttachmentBlocks} scopeKey={scopeKey} title="Unfiled files">
        {({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={scopeKey} enabled={!editing} actions={{ more: load }} scope={{ unfiled: { items, status, loadLabel: busy ? 'Reading files…' : complete ? 'All files loaded' : 'Load more files', disabled: busy || complete } }}><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} /></TransientBlockHost>}
      </SettingsDocumentHost>
    </Box>
  </Flex>;
}
