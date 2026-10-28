import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ComponentDataScope } from './ComponentSelect';
import { WebpageBlocksRenderer } from './WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from './webpageRuntime';
import type { WebpageBlock } from './webpageBlocks';

const blocks: WebpageBlock[] = [
	{ id: 'new-gate', type: 'condition', condition: { arg: 'query.view', equals: 'new' }, children: [{ id: 'new-text', type: 'text', text: 'New view is visible' }] },
	{ id: 'routes-gate', type: 'condition', condition: { arg: 'query.view', equals: 'routes' }, children: [{ id: 'routes-text', type: 'text', text: 'Routes view is visible' }] },
	{ id: 'scope-gate', type: 'condition', condition: { arg: 'inherited', equals: 'yes' }, children: [{ id: 'scope-text', type: 'text', text: 'Inherited data is visible' }] }
];

function render(search: string, enabled: boolean) {
	const content = <ComponentDataScope.Provider value={{ inherited: 'yes', query: { view: 'stale' } }}>
		<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} interactive={false} />
	</ComponentDataScope.Provider>;
	const page = <ChakraProvider>{enabled
		? <WebpageRuntimeProvider pageId="saved-page" pageKey="saved-key" suiteKey={null} source="user">{content}</WebpageRuntimeProvider>
		: content}</ChakraProvider>;
	const router = createMemoryRouter([{ id: 'root', path: '/p/:id', element: page }], {
		initialEntries: [`/p/saved-page?view=${search}`],
		hydrationData: { loaderData: { root: { user: { id: 'owner' } } } }
	});
	try { return renderToStaticMarkup(<RouterProvider router={router} />); }
	finally { router.dispose(); }
}

test('saved page conditions read current URL query without losing inherited Component data', () => {
	const newPage = render('new', true);
	assert.match(newPage, /New view is visible/);
	assert.doesNotMatch(newPage, /Routes view is visible/);
	assert.match(newPage, /Inherited data is visible/);
	const routesPage = render('routes', true);
	assert.match(routesPage, /Routes view is visible/);
	assert.doesNotMatch(routesPage, /New view is visible/);
});

test('inert Builder rendering retains its existing Component scope', () => {
	const inert = render('new', false);
	assert.doesNotMatch(inert, /New view is visible/);
	assert.match(inert, /Inherited data is visible/);
});
