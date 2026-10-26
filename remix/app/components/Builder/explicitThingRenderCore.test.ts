import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { resolveTemplate } from '../ComponentsLibrary/componentTemplate';
import { LiveTemplate } from './liveComponent';
import { WebpageRuntimeProvider } from './webpageRuntime';
import { DefinitionValueEditor } from './DefinitionEditor/DefinitionValueEditor';
import {
	currentExplicitComponentResolution,
	explicitComponentInteractive,
	explicitThingRenderScope,
	parseExplicitRenderComponent,
	resolveSavedRenderComponent
} from './explicitThingRenderCore';
import type { ThingsThing } from '../Things/thingsCore';

const thing = (crystal: Record<string, unknown>, updatedAt = '2026-10-26T00:00:00.000Z'): ThingsThing => ({
	id: 'thing-1', thingtime: ['data'], author: null, visibility: 'private', acl: ['tt:user'], targetId: null, folderId: null,
	crystal, extended: null, tags: [], createdAt: updatedAt, updatedAt
});

test('accepts only explicit saved Component Thing pointers', () => {
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { thingId: 'component-card' } })), {
		status: 'ready', value: { kind: 'reference', thingId: 'component-card' }
	});
	assert.deepEqual(parseExplicitRenderComponent(thing({ type: 'card' })), { status: 'absent' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: 'component-card' })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { thingId: 'component-card', definition: { render: { tag: 'p' } } } })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { thingId: 123, definition: { render: { tag: 'p' } } } })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { thingId: '   ' } })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { thingId: 123 } })), { status: 'invalid' });
});

test('rejects malformed embedded and saved render trees instead of painting a blank presentation', () => {
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { definition: { render: {} } } })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { definition: { render: { foo: 'bar' } } } })), { status: 'invalid' });
	assert.deepEqual(parseExplicitRenderComponent(thing({ renderComponent: { definition: { render: { tag: 'p', props: { '$where': 'bad' } } } } })), { status: 'invalid' });
	assert.equal(resolveSavedRenderComponent({ id: 'component-card', thingtime: ['component'], crystal: { render: {} } }, 'component-card').status, 'invalid');
});

test('embedded definitions render editable source content through the canonical component scope', () => {
	const source = thing({
		thing: { title: 'Wren', text: 'Ready to coordinate' },
		renderComponent: { definition: { render: { tag: 'article', children: ['{content.title}', '{content.text}'] } } }
	});
	const parsed = parseExplicitRenderComponent(source);
	assert.equal(parsed.status, 'ready');
	if (parsed.status !== 'ready' || parsed.value.kind !== 'embedded') return;
	assert.deepEqual(resolveTemplate(parsed.value.component.crystal.render, explicitThingRenderScope(source)), {
		tag: 'article', children: ['Wren', 'Ready to coordinate']
	});
});

test('saved references require the exact accessible Component Thing identity and render definition', () => {
	assert.deepEqual(resolveSavedRenderComponent({ id: 'component-card', thingtime: ['component'], author: { id: 'author-1' }, crystal: { render: { tag: 'p', children: ['Hello'] } } }, 'component-card'), {
		status: 'ready', component: { id: 'component-card', author: { id: 'author-1' }, crystal: { render: { tag: 'p', children: ['Hello'] } } }
	});
	assert.equal(resolveSavedRenderComponent({ id: 'different-component', thingtime: ['component'], crystal: { render: { tag: 'p' } } }, 'component-card').status, 'invalid');
	assert.equal(resolveSavedRenderComponent({ id: 'component-card', thingtime: ['schema'], crystal: { render: { tag: 'p' } } }, 'component-card').status, 'wrong-kind');
	assert.equal(resolveSavedRenderComponent({ id: 'component-card', thingtime: ['component'], crystal: {} }, 'component-card').status, 'invalid');
	assert.equal(resolveSavedRenderComponent(null, 'component-card').status, 'unavailable');
});

test('embedded definitions inherit source ownership but saved references require proven component ownership', () => {
	assert.equal(explicitComponentInteractive('embedded', 'owner-1', 'owner-1', undefined), true);
	assert.equal(explicitComponentInteractive('embedded', 'visitor-1', 'owner-1', undefined), false);
	assert.equal(explicitComponentInteractive('reference', 'owner-1', 'owner-1', 'owner-1'), true);
	assert.equal(explicitComponentInteractive('reference', 'owner-1', 'owner-1', undefined), false, 'authorless saved components stay inert');
	assert.equal(explicitComponentInteractive('reference', 'owner-1', 'owner-1', 'other-owner'), false, 'foreign saved components stay inert');
});

test('a prior identity resolution cannot render after the viewer or data plane changes', () => {
	const stale = { key: 'account-a:plane-a', status: 'ready' as const, component: { id: 'component-card', crystal: { render: { tag: 'p' } } } };
	assert.equal(currentExplicitComponentResolution(stale, stale.key), stale);
	assert.deepEqual(currentExplicitComponentResolution(stale, 'account-b:plane-b'), {
		key: 'account-b:plane-b', status: 'loading', component: null
	});
	assert.equal(currentExplicitComponentResolution({ key: 'account-b:plane-b', status: 'unavailable', component: null }, 'account-b:plane-b').status, 'unavailable');
	assert.equal(currentExplicitComponentResolution({ key: 'account-b:plane-b', status: 'wrong-kind', component: null }, 'account-b:plane-b').status, 'wrong-kind');
});

test('LiveTemplate renders the supported tag, props, children definition and the canonical editor exposes nested fields', () => {
	const render = { tag: 'article', props: { 'aria-label': 'Agent note', style: { padding: '16px' } }, children: [{ tag: 'p', children: ['{content.text}'] }] };
	const live = React.createElement(
		ChakraProvider,
		null,
		React.createElement(WebpageRuntimeProvider, {
			pageId: 'thing-1', pageKey: null, suiteKey: null, source: 'user', shared: false,
			children: React.createElement(LiveTemplate, { render, scope: { content: { text: 'Ready to coordinate' } }, interactive: false })
		})
	);
	const router = createMemoryRouter([{ id: 'root', path: '/', element: live }], { hydrationData: { loaderData: { root: { user: { id: 'owner-1' } } } } });
	try {
		const markup = renderToStaticMarkup(React.createElement(RouterProvider, { router }));
		assert.match(markup, /<article/);
		assert.match(markup, /aria-label="Agent note"/);
		assert.match(markup, /Ready to coordinate/);
	} finally {
		router.dispose();
	}

	const editor = renderToStaticMarkup(React.createElement(ChakraProvider, null,
		React.createElement(DefinitionValueEditor, { value: { render }, onChange: () => {} })
	));
	assert.match(editor, /Expand render/);
	assert.match(editor, /Remove render/);
	assert.match(editor, /Add property/);
});
