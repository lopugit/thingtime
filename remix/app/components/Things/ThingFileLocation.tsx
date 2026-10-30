import React from 'react';
import { useApi } from '~/hooks/useApi';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { useDataPlane } from '~/hooks/useDataPlane';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { resolveFileLocation, type FileLocation, type LocationThing } from './fileLocationCore';

export const fileLocationBlocks: WebpageBlock[] = [{
  id: 'file-location', type: 'element', tag: 'section', props: { 'aria-label': 'Saved file location' },
  css: { display: 'grid', gap: '8px', padding: '16px', border: '1px solid var(--tt-border, #e4e4e7)', 'border-radius': '12px', 'min-width': '0' },
  children: [
    { id: 'file-location-heading', type: 'element', tag: 'h2', text: '{fileLocation.heading}' },
    { id: 'file-location-status', type: 'element', tag: 'p', text: '{fileLocation.status}', props: { role: 'status' } },
    { id: 'file-location-path', type: 'collection', props: { itemsPath: 'fileLocation.segments', label: 'Folder path', hideSearch: true, hideSize: true, hideCount: true, size: 'all', empty: '' }, children: [
      { id: 'file-location-segment', type: 'element', tag: 'span', css: { display: 'inline-flex', 'align-items': 'center', gap: '8px', 'min-width': '0' }, children: [
        { id: 'file-location-separator', type: 'element', tag: 'span', text: '{item.separator}', props: { 'aria-hidden': true } },
        { id: 'file-location-name', type: 'element', tag: 'a', text: '{item.name}', props: { href: '{item.href}' }, css: { display: 'inline-flex', 'align-items': 'center', 'min-height': '44px', 'overflow-wrap': 'anywhere' } }
      ] }
    ] }
  ]
}];

export function ThingFileLocation({ thing }: { thing: LocationThing }) {
  const api = useApi(), user = useCurrentUser(), plane = useDataPlane();
  const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
  const apiRef = React.useRef(api); apiRef.current = api;
  const [result, setResult] = React.useState<{ key: string; value: FileLocation } | null>(null);
  const scopeKey = JSON.stringify([user?.id, plane, identity.generation, thing.id, thing.targetId, thing.folderId, thing.fileSyncOrigin]);
  React.useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void resolveFileLocation(thing, async (id) => {
      const response = await apiRef.current.v1.things.get({ id }, { signal: controller.signal, expectedActor: user?.id, expectedDataPlane: plane });
      controller.signal.throwIfAborted();
      return response?.thing ?? null;
    }).then(value => { if (!controller.signal.aborted) setResult({ key: scopeKey, value }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ key: scopeKey, value: { state: 'unavailable', segments: [] } }); });
    return () => controller.abort();
  }, [scopeKey]); // exact account/data-plane and stored placement identity
  const current = result?.key === scopeKey ? result.value : null;
  const status = !current ? 'Checking the saved folder location…' : current.state === 'recorded'
    ? 'Recorded current cloud folder path. Select a folder to open it.' : current.state === 'origin'
    ? 'Original sync source path recorded before upload. File publication is incomplete; this is not a verified current file path. The link opens the original intended destination folder.' : current.state === 'unrecorded'
    ? 'No recorded folder location. This storage attachment is not linked to a saved file with a folder path.'
    : 'The saved location could not be verified with your current access.';
  return <SettingsDocumentHost documentKey="thing-file-location" defaultDocument={fileLocationBlocks} scopeKey={scopeKey} title="File location">
    {({ blocks, chrome, editing }) => <TransientBlockHost enabled={!editing} scopeKey={scopeKey} actions={{}} scope={{ fileLocation: { heading: current?.state === 'origin' ? 'Original sync path' : 'Saved location', status, segments: (current?.segments ?? []).map((segment, index) => ({ ...segment, separator: index ? '/' : '' })) } }}>
      <WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} />
    </TransientBlockHost>}
  </SettingsDocumentHost>;
}
