import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChakraProvider } from '@chakra-ui/react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { hasNativeApp, NATIVE_APP_TAGS, WebpageBlocksRenderer, type BuilderChrome } from './WebpageBlocksRenderer';
import { WebpageRuntimeProvider } from './webpageRuntime';
import type { WebpageBlock } from './webpageBlocks';

// The service workspace is inserted as an HTML block
// (BlockInsertMenu → <tt-service-workspace …>). The block view — not only
// LiveTemplate — must provide NativeControlsEnabled, or the live /p/ page and
// the seamless editor both show the inert placeholder (the production
// regression after the "safe previews" merge). These tests pin the surfaces
// that must run the app and the ones that must stay inert.

const WORKSPACE_HTML = '<tt-service-workspace rootId="hq-root" name="Jim’s Mowing HQ"></tt-service-workspace>';

// htmlToNode parses authored markup with the browser's DOMParser and returns
// null on the server. A static render therefore needs the smallest DOM that
// walks a flat tag/attribute/text tree — enough for the fixtures below, and
// deliberately no more (the allowlist renderer, not this parser, is the
// security boundary under test elsewhere).
type FakeNode = { nodeType: number; textContent: string; tagName?: string; attributes?: { name: string; value: string }[]; style?: null; childNodes: FakeNode[] & { forEach: FakeNode[]['forEach'] } };
const parseFragment = (html: string): FakeNode => {
	const element = (tagName: string, attributes: { name: string; value: string }[] = []): FakeNode => ({ nodeType: 1, tagName, attributes, style: null, childNodes: [], get textContent() { return this.childNodes.map((child: FakeNode) => child.textContent).join(''); } } as FakeNode);
	const root = element('BODY');
	const stack = [root];
	const token = /<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
	for (const match of html.matchAll(token)) {
		const [, close, open, attrText, selfClosing, text] = match;
		const parent = stack[stack.length - 1];
		if (close) {
			if (stack.length > 1 && stack[stack.length - 1].tagName === close.toUpperCase()) stack.pop();
		} else if (open) {
			const attributes = [...(attrText || '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => ({ name, value: value ?? '' }));
			const child = element(open.toUpperCase(), attributes);
			parent.childNodes.push(child);
			if (!selfClosing) stack.push(child);
		} else if (text) parent.childNodes.push({ nodeType: 3, textContent: text, childNodes: [] as any });
	}
	return root;
};
const withDom = <T,>(run: () => T): T => {
	const globals = globalThis as any;
	const previous = { window: globals.window, DOMParser: globals.DOMParser, Node: globals.Node };
	globals.window = globals.window ?? {};
	globals.Node = globals.Node ?? { ELEMENT_NODE: 1, TEXT_NODE: 3 };
	globals.DOMParser = class { parseFromString(html: string) { return { body: parseFragment(html) }; } };
	try {
		return run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete globals[key];
			else globals[key] = value;
		}
	}
};

const chromeFor = (seamlessMode?: BuilderChrome['seamlessMode']): BuilderChrome => ({
	seamlessMode,
	hoverId: null,
	selectedId: null,
	onHover: () => {},
	onSelect: () => {},
	onInsert: () => {},
	onMove: () => {}
});

const renderPage = (props: { interactive?: boolean; chrome?: BuilderChrome | null; html?: string }) =>
	withDom(() => {
		const blocks: WebpageBlock[] = [{ id: 'service-1', type: 'html', html: props.html ?? WORKSPACE_HTML }];
		const element = React.createElement(
			ChakraProvider,
			null,
			React.createElement(WebpageRuntimeProvider, {
				pageId: 'hq-page',
				pageKey: 'jims-mowing-hq',
				suiteKey: null,
				source: 'user',
				shared: false,
				children: React.createElement(WebpageBlocksRenderer, {
					blocks,
					componentsByRef: {},
					interactive: props.interactive,
					chrome: props.chrome ?? null
				})
			})
		);
		const router = createMemoryRouter([{ id: 'root', path: '/', element }], { hydrationData: { loaderData: { root: { user: { id: 'owner' } } } } });
		try {
			return renderToStaticMarkup(React.createElement(RouterProvider, { router }));
		} finally {
			router.dispose();
		}
	});

// A static render cannot resolve the lazy workspace chunk: the Suspense
// fallback is the proof that the app mounted, the placeholder copy is the
// proof that it did not.
const LIVE = /Opening workspace…/;
const INERT = /runs on the live page/;

test('the live page runs a service workspace inside an html block', () => {
	const markup = renderPage({ interactive: true });
	assert.match(markup, LIVE);
	assert.doesNotMatch(markup, INERT);
	assert.doesNotMatch(markup, /Live app preview/, 'the hint is editor chrome, never live-page content');
});

test('inert surfaces keep the workspace placeholder and never mount its loader', () => {
	for (const props of [{ interactive: false }, {}, { interactive: false, chrome: chromeFor(undefined) }]) {
		const markup = renderPage(props);
		assert.match(markup, INERT, JSON.stringify(props));
		assert.doesNotMatch(markup, LIVE, JSON.stringify(props));
		assert.match(markup, /Jim’s Mowing HQ/, 'the placeholder still names the workspace');
	}
});

test('every seamless runtime mode shows the real app; View runs it without the hint', () => {
	for (const mode of ['edit', 'layout'] as const) {
		const markup = renderPage({ interactive: true, chrome: chromeFor(mode) });
		assert.match(markup, LIVE, mode);
		assert.match(markup, /Live app preview/, `${mode} mode tells the editor the app is a preview`);
	}
	const view = renderPage({ interactive: true, chrome: chromeFor('view') });
	assert.match(view, LIVE);
	assert.doesNotMatch(view, /Live app preview/);
});

test('Builder mode (page data disabled) stays inert', () => {
	// LiveWebpage passes interactive=false for the builder mode; the block view
	// must not re-enable the app on its own.
	const markup = renderPage({ interactive: false, chrome: chromeFor('builder') });
	assert.match(markup, INERT);
	assert.doesNotMatch(markup, /Live app preview|Opening workspace/);
});

test('the editor hint only appears for html blocks that carry a native app', () => {
	const plain = renderPage({ interactive: true, chrome: chromeFor('edit'), html: '<p>Just a paragraph about tt-service-workspace.</p>' });
	assert.match(plain, /Just a paragraph/);
	assert.doesNotMatch(plain, /Live app preview|Opening workspace/);
	assert.equal(hasNativeApp('<p>tt-service-workspace as text</p>'), false);
	assert.equal(hasNativeApp('<TT-SERVICE-WORKSPACE rootId="x"></TT-SERVICE-WORKSPACE>'), true);
	assert.equal(hasNativeApp('<tt-service-workspace/>'), true);
	assert.equal(hasNativeApp('<tt-service-workspace-later></tt-service-workspace-later>'), false);
	assert.deepEqual([...NATIVE_APP_TAGS], ['tt-service-workspace']);
});
