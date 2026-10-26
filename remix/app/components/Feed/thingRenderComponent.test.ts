import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ThingRenderComponent } from '../Thingtime/ThingRenderComponent';
import { ComponentDisplayOnly, NativeControlsEnabled } from '../Builder/NativeComponentControls';
import { ComponentUploadEnabled } from '../Builder/ComponentUpload';
import { ComponentDataScope } from '../Builder/ComponentSelect';
import { ChakraThingRenderer } from '../Kinds/ChakraThingRenderer';
import { HtmlThingRenderer, type HtmlThingNode } from '../Kinds/HtmlThingRenderer';
import { hasRenderComponent, renderComponentDeclaration, referencedRenderComponent, renderComponentNode } from '../Thingtime/renderComponentCore';
import { buildThingCreateRequestPayload } from '../../hooks/thingsRequestPayload';

const template = { render: { tag: 'p', props: { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, children: ['{text}'] } };

test('rendering requires the explicit Component pointer or embedded definition, never a type alias', () => {
  assert.equal(renderComponentDeclaration({ type: 'text', text: 'Inspect this data' }), null);
  assert.equal(hasRenderComponent({ kind: 'text', text: 'Inspect this too' }), false);
  assert.deepEqual(renderComponentDeclaration({ renderComponent: { id: 'saved-component' } }), { kind: 'reference', id: 'saved-component' });
  assert.deepEqual(renderComponentDeclaration({ renderComponent: template }), { kind: 'embedded', component: template });
});

test('malformed explicit Components remain authoritative instead of silently falling through', () => {
  for (const renderComponent of [null, 'text', 'plain-text', [], {}, { id: '' }, { render: [] }, { render: {} }, { render: { foo: 'bar' } }, { id: 'component', render: {} }]) {
    const data = { renderComponent, type: 'text', kind: 'rich-text', text: 'Keep raw data available' };
    assert.equal(hasRenderComponent(data), true);
    assert.deepEqual(renderComponentDeclaration(data), { kind: 'invalid' });
  }
});

test('saved renderer reads only accept an actual Component Thing with a render definition', () => {
  const valid = { id: 'component', thingtime: ['component'], crystal: template };
  assert.deepEqual(referencedRenderComponent(valid, 'component'), template);
  for (const invalid of [null, { ...valid, id: 'different-component' }, { ...valid, thingtime: ['data'] }, { ...valid, crystal: { render: [] } }, { ...valid, crystal: { render: {} } }, { ...valid, crystal: { render: { foo: 'bar' } } }, { crystal: template }]) {
    assert.equal(referencedRenderComponent(invalid, 'component'), null);
  }
});

test('canonical create payload retains pointers and embedded definitions at the displayed data level', () => {
  for (const renderComponent of [{ id: 'saved-component' }, template]) {
    const data = { renderComponent, text: 'Saved authored content' };
    for (const args of [{ type: 'thing', thing: data }, { thingtime: ['data'], crystal: data }, { thingtime: ['post'], crystal: { thing: data } }]) {
      const stored = JSON.parse(JSON.stringify(buildThingCreateRequestPayload(args)));
      const displayed = stored.thing || stored.crystal.thing || stored.crystal;
      assert.deepEqual(displayed, data);
      assert.ok(renderComponentDeclaration(displayed));
    }
  }
});

test('Component bindings receive current Thing fields and explicit thing alias without interpreting content as markup', () => {
  const text = '<img src=x onerror="unsafe()">\n  preserved whitespace\n' + 'x'.repeat(20000);
  const component = { ...template, render: { ...template.render, children: ['{text}', '{thing.summary}'] } };
  const node = renderComponentNode(component, { text, summary: 'Nested field' });
  const markup = renderToStaticMarkup(React.createElement(HtmlThingRenderer, { node: node as HtmlThingNode }));
  assert.doesNotMatch(markup, /<img|<script/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /Nested field/);
  assert.match(markup, /white-space:pre-wrap/);
  assert.match(markup, /overflow-wrap:anywhere/);
  assert.ok(markup.includes('x'.repeat(20000)));
});

test('Component templates preserve empty fields and sanitize author markup through the canonical renderer', () => {
  for (const text of ['', '  \n\t']) {
    const node = renderComponentNode(template, { text }) as HtmlThingNode;
    assert.ok(node && typeof node === 'object' && 'children' in node);
    assert.deepEqual(node.children, [text]);
  }
  const node = renderComponentNode({ render: { tag: 'p', props: { onClick: 'unsafe()' }, children: [{ tag: 'script', children: ['unsafe()'] }, '{text}'] } }, { text: 'Safe content' });
  const markup = renderToStaticMarkup(React.createElement(HtmlThingRenderer, { node: node as HtmlThingNode }));
  assert.match(markup, /Safe content/);
  assert.doesNotMatch(markup, /onclick|<script/i);
});

test('Component read scope captures the expected actor, Character, origin and database independently', async () => {
  const { renderComponentReadOptions } = await import('../Thingtime/renderComponentCore');
  const signal = new AbortController().signal;
  const first = renderComponentReadOptions({ actor: 'character-a', character: 'character-a', plane: 'home', origin: 'https://thingtime.com' }, signal);
  const next = renderComponentReadOptions({ actor: 'character-b', character: 'character-b', plane: null, origin: 'https://local.example' }, signal);
  assert.equal(first.expectedActor, 'character-a');
  assert.equal(first.characterId, 'character-a');
  assert.equal(next.expectedActor, 'character-b');
  assert.equal(next.characterId, 'character-b');
  assert.equal(next.expectedApiOrigin, 'https://local.example');
  assert.equal(next.expectedDataPlane, null);
  assert.equal(next.signal, signal);
});

test('display-only Component markup cannot publish delegated Actions or mount executable native programs', async () => {
  const html = renderToStaticMarkup(React.createElement(ComponentDisplayOnly.Provider, { value: true }, React.createElement(HtmlThingRenderer, { node: {
    tag: 'div', children: [
      { tag: 'button', props: { 'data-tt-action': 'private-action', 'data-tt-action-inputs': '{"secret":"value"}' }, children: ['Visible label'] },
      { tag: 'tt-web-platform', props: { program: 'execute code' } },
      { tag: 'tt-change', props: { 'data-tt-action': 'private-change' }, children: ['Change label'] },
      { tag: 'tt-drop', props: { 'data-tt-action': 'private-drop' }, children: ['Drop label'] }
    ]
  } })));
  assert.match(html, /Visible label/);
  assert.match(html, /Change label/);
  assert.match(html, /Drop label/);
  assert.match(html, /Web Platform programs are available on the interactive page/);
  assert.doesNotMatch(html, /data-tt-action|iframe|execute code/);
  const chakra = renderToStaticMarkup(React.createElement(ComponentDisplayOnly.Provider, { value: true }, React.createElement(ChakraThingRenderer, { node: {
    chakra: 'Box', children: [
      { chakra: 'Button', props: { 'data-tt-action': 'private-action' }, children: ['Visible Chakra label'] },
      { chakra: 'IntegrationExample', props: { exampleId: 'private-example' } },
      { chakra: 'Change', props: { 'data-tt-action': 'private-change' }, children: ['Change label'] },
      { chakra: 'DropTarget', props: { 'data-tt-action': 'private-drop' }, children: ['Drop label'] }
    ]
  } })));
  assert.match(chakra, /Visible Chakra label/);
  assert.match(chakra, /Change label/);
  assert.match(chakra, /Drop label/);
  assert.match(chakra, /Integration examples are available on the interactive page/);
  assert.doesNotMatch(chakra, /data-tt-action|iframe|private-example/);
});

test('explicit display resets inherited upload authority and supplies its own collection scope', async () => {
  const data = { items: [{ title: 'Own displayed record' }], renderComponent: { render: { tag: 'div', children: [
    { tag: 'tt-upload', props: { name: 'never-upload' } },
    { tag: 'tt-collection', props: { itemsPath: 'items', itemTemplate: { ttTemplate: { tag: 'p', children: ['{item.title}'] } } } }
  ] } } };
  const element = React.createElement(NativeControlsEnabled.Provider, { value: true },
    React.createElement(ComponentUploadEnabled.Provider, { value: true },
      React.createElement(ComponentDataScope.Provider, { value: { items: [{ title: 'Unrelated parent private data' }] } },
        React.createElement(ThingRenderComponent, { thing: data }))));
  const router = createMemoryRouter([{ id: 'root', path: '/', element }], { hydrationData: { loaderData: { root: { user: { id: 'viewer' } } } } });
  try {
    const markup = renderToStaticMarkup(React.createElement(RouterProvider, { router }));
    assert.match(markup, /File upload \(available on an interactive owned component\)/);
    assert.doesNotMatch(markup, /Unrelated parent private data|Choose files|Upload files/);
    assert.match(markup, /Own displayed record/);
  } finally { router.dispose(); }
});
