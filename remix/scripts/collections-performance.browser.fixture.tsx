import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRevalidator } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import * as Runtime from '../app/components/Builder/webpageRuntime';
import { WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import { useCollectionSource } from '../app/components/Builder/useCollectionSource';
import { NativeControlsEnabled } from '../app/components/Builder/NativeComponentControls';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';
let dataPlane = 'home';
const blocks: WebpageBlock[] = [
 { id: 'title', type: 'element', tag: 'h1', text: 'Collection renderer fixture' },
 { id: 'draft', type: 'element', tag: 'input', props: { 'aria-label': 'Fixture draft' } },
 { id: 'select', type: 'element', tag: 'button', text: 'Select item 48', props: { type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'query', scope: 'page', params: { selected: 'row-48' } } } },
 { id: 'collection', type: 'collection', props: { label: 'Fixture records', size: 10, total: 58, selectedKey: '{query.selected}', itemKey: 'id', revealSelected: true, source: { action: 'fixture-list', itemsPath: 'items', offsetInput: 'offset', limitInput: 'limit' } }, children: [
  { id: 'row', type: 'element', tag: 'p', text: '{item.label}', props: { 'data-fixture-row': '{item.id}' } }
 ] },
 { id: 'bottom', type: 'element', tag: 'p', text: 'Fixture page bottom' }
];
function Fixture() {
 const { revalidate } = useRevalidator();
 return <ChakraProvider><button type="button" onClick={() => { dataPlane = dataPlane === 'home' ? 'custom-' + 'a'.repeat(64) : 'home'; void revalidate(); }}>Switch fixture database</button>
 <WebpageRuntimeProvider pageId="fixture-collections" pageKey={null} suiteKey={null} source="user" shared><PageActionSurface actionEnabled><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive /></PageActionSurface></WebpageRuntimeProvider></ChakraProvider>;
}
// The fixture server adds this export to the runtime module in memory only.
// This exercises the actual hook with deterministic transport exceptions.
const ScopeRuntime = (Runtime as any).FixtureRuntimeContext;
function ScopeRows({ variant }: { variant: string }) {
 const collection = useCollectionSource({ action: 'scope-list', inputs: { variant }, offsetInput: 'offset', limitInput: 'limit' });
 (window as any).scopeCollection = collection;
 return <><button onClick={() => void collection.loadMore()}>Refresh scope records</button><pre data-scope-state>{JSON.stringify({ items: collection.items, pages: collection.pageData, error: collection.error, pageError: collection.pageError })}</pre></>;
}
function ScopeFixture() {
 const [boundary, setBoundary] = React.useState(0);
 const [variant, setVariant] = React.useState('first');
 const identity = React.useMemo(() => ({ key: boundary }), [boundary]);
 const value = React.useMemo(() => ({ identity, viewer: { signedIn: true, id: 'synthetic-same-account' }, pageId: 'scope-fixture', version: 0, load: (_key: string, fetcher: () => Promise<unknown>) => fetcher(), sharedRun: async (_action: string, inputs: unknown) => {
  const response = await fetch('/fixture-scope-load', { method: 'POST', body: JSON.stringify(inputs) });
  const result = await response.json();
  if (result.throwStatus) throw Object.assign(new Error('Thrown access refusal'), { status: result.throwStatus });
  return result;
 } }), [identity]);
 return <ScopeRuntime.Provider value={value}><NativeControlsEnabled.Provider value={true}><button onClick={() => setBoundary(x => x + 1)}>Switch scope data plane</button><button onClick={() => setVariant(x => x === 'first' ? 'second' : 'first')}>Switch scope source</button><ScopeRows variant={variant} /></NativeControlsEnabled.Provider></ScopeRuntime.Provider>;
}
const router = createBrowserRouter([{ id: 'root', path: '*', element: location.pathname.endsWith('-scope') ? <ScopeFixture /> : <Fixture />, loader: () => ({ dataPlane }) }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
