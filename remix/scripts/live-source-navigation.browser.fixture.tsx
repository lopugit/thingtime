import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider } from '@chakra-ui/react';
import { createBrowserRouter, RouterProvider, useRevalidator } from 'react-router';
import { WebpageBlocksRenderer } from '../app/components/Builder/WebpageBlocksRenderer';
import { useWebpageRuntime, WebpageRuntimeProvider } from '../app/components/Builder/webpageRuntime';
import { PageActionSurface } from '../app/components/Builder/PageActionSurface';
import { useThingSource } from '../app/components/Builder/liveComponent';
import type { WebpageBlock } from '../app/components/Builder/webpageBlocks';

const blocks: WebpageBlock[] = [{ id: 'workspace', type: 'container', source: {
	action: 'fixture-list', inputs: { q: '{query.q}' }, retainOnInputChange: ['q']
}, children: [
	{ id: 'query-form', type: 'element', tag: 'fieldset', children: [
		{ id: 'query-input', type: 'element', tag: 'input', props: { type: 'search', name: 'q', 'aria-label': 'Filter records' } },
		{ id: 'query-submit', type: 'element', tag: 'button', text: 'Apply filter', props: {
			type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'query', form: true, params: { q: '' } }
		} }
	] },
	{ id: 'list', type: 'element', tag: 'p', text: '{result.text}' },
	{ id: 'target', type: 'container', source: {
		action: 'fixture-target', inputs: { id: '{query.itemId}', q: '{query.q}' }, retainOnInputChange: ['q']
	}, children: [
		{ id: 'target-text', type: 'element', tag: 'p', text: '{result.text}' },
		{ id: 'draft-control', type: 'element', tag: 'button', text: 'Edit local draft', props: {
			type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'set', key: 'draftStatus', value: 'edited' }
		} },
		{ id: 'draft-status', type: 'element', tag: 'p', text: 'Draft {draftStatus}' }
	] },
	{ id: 'target-link', type: 'element', tag: 'button', text: 'Open another record', props: {
		type: 'button', 'data-tt-action': '$ui', 'data-tt-action-inputs': { op: 'query', params: { q: 'fast', itemId: 'second' } }
	} }
] }];

let viewer: { id: string } | null = { id: 'owner' };
function RuntimeProbe() {
	const runtime = useWebpageRuntime();
	const source = useThingSource({ source: { action: 'fixture-list', inputs: { q: '{query.q}' }, retainOnInputChange: ['q'] }, cacheId: 'probe', argValues: {}, interactive: true });
	return <pre id="runtime-state">{JSON.stringify({ viewerId: runtime.viewer.id, pageId: runtime.pageId, query: runtime.query, state: source.scope.state, refreshing: source.scope.refreshing, error: source.scope.error })}</pre>;
}
function Fixture() {
	const revalidator = useRevalidator();
	return <ChakraProvider>
		<button type="button" onClick={() => { viewer = null; revalidator.revalidate(); }}>Change viewer</button>
		<WebpageRuntimeProvider pageId="fixture" pageKey={null} suiteKey={null} source="user">
			<RuntimeProbe />
			<PageActionSurface actionEnabled><WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive /></PageActionSurface>
		</WebpageRuntimeProvider>
	</ChakraProvider>;
}

const router = createBrowserRouter([{ id: 'root', path: '/p/:id', element: <Fixture />, loader: () => ({ user: viewer, dataPlane: 'home' }) }]);
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
