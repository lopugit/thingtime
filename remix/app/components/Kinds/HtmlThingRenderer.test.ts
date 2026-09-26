import assert from 'node:assert/strict';
import { test } from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { NativeControlsEnabled } from '../Builder/NativeComponentControls';
import { WebpageRuntimeProvider, useWebpageRuntime } from '../Builder/webpageRuntime';
import { ALLOWED_PROPS, HtmlThingRenderer, InteractiveWorkspace } from './HtmlThingRenderer.tsx';

// The prop allowlist IS the trust boundary for component things: a component
// crystal is untrusted data, and every name in this set is something its
// author gets to hand the browser. These tests pin the decisions that are
// easy to undo by habit.

test('the form-field props the ttAction click wrapper needs are allowed', () => {
	// Named fields inside a component root become run inputs
	// (webpageRuntime.gatherFormFields), so the markup that produces them has
	// to render.
	for (const prop of ['name', 'type', 'value', 'checked', 'placeholder', 'min', 'max', 'step', 'maxLength', 'required', 'readOnly', 'htmlFor', 'selected', 'inputMode']) {
		assert.ok(ALLOWED_PROPS.has(prop), `${prop} must render for component forms to work`);
	}
});

test('no author-supplied regex reaches the browser through `pattern`', () => {
	// Constraint validation compiles and runs `pattern` on the main thread,
	// with no timeout, as soon as the field has a value — and a template can
	// ship the value too (fieldProps turns `value` into `defaultValue`). A
	// catastrophic pattern would then wedge the tab of anyone who merely
	// renders that component thing. Run inputs are validated server-side by
	// the action's input descriptors, so nothing here needs it.
	assert.equal(ALLOWED_PROPS.has('pattern'), false);
});

test('event handlers and script sinks stay out of the allowlist', () => {
	for (const prop of ['onClick', 'onclick', 'onError', 'dangerouslySetInnerHTML', 'srcDoc', 'srcdoc', 'formAction', 'xlinkHref']) {
		assert.equal(ALLOWED_PROPS.has(prop), false, `${prop} must never render from untrusted markup`);
	}
});


test('inert HTML previews do not mount service workspace data or controls', () => {
  const markup = renderToStaticMarkup(React.createElement(HtmlThingRenderer, { node: { tag: 'tt-service-workspace', props: { rootId: 'private-workspace', name: 'Jim’s Mowing HQ' } } }));
  assert.match(markup, /runs on the live page/);
  assert.match(markup, /Jim’s Mowing HQ/, 'the placeholder names the workspace instead of a generic component');
  assert.doesNotMatch(markup, /Opening workspace|Create workspace|private-workspace/);
  let mounts = 0;
  const WorkspaceProbe = () => { mounts++; return React.createElement('button', null, 'Save workspace'); };
  renderToStaticMarkup(React.createElement(NativeControlsEnabled.Provider, { value: false }, React.createElement(InteractiveWorkspace, null, React.createElement(WorkspaceProbe))));
  assert.equal(mounts, 0, 'an inert surface never reaches the workspace component or its loaders');
});

test('interactive shared pages still mount workspace controls for enrolled nonowner staff', () => {
  let viewer: string | null = null;
  let shared = false;
  const StaffWorkspace = () => {
    const runtime = useWebpageRuntime();
    viewer = runtime.viewer.id;
    shared = !!runtime.sharedRun;
    return React.createElement('button', null, 'Save authorized workspace');
  };
  const element = React.createElement(WebpageRuntimeProvider, { pageId: 'owners-page', pageKey: null, suiteKey: null, source: 'system', shared: true, children:
    React.createElement(NativeControlsEnabled.Provider, { value: true }, React.createElement(InteractiveWorkspace, null, React.createElement(StaffWorkspace))) });
  const router = createMemoryRouter([{ id: 'root', path: '/', element }], { hydrationData: { loaderData: { root: { user: { id: 'staff-member' } } } } });
  try {
    const markup = renderToStaticMarkup(React.createElement(RouterProvider, { router }));
    assert.match(markup, /Save authorized workspace/);
    assert.equal(viewer, 'staff-member');
    assert.equal(shared, true, 'shared runtime is not mistaken for an inert preview');
  } finally { router.dispose(); }
});

test('populated textarea templates never receive competing children and defaultValue',()=>{
 for(const children of [[],['legacy text'],undefined]) {
  const markup=renderToStaticMarkup(React.createElement(HtmlThingRenderer,{node:{tag:'textarea',props:{name:'notes',value:'Saved notes'},children}}));
  assert.match(markup,/>Saved notes<\/textarea>/);
 }
 const legacy=renderToStaticMarkup(React.createElement(HtmlThingRenderer,{node:{tag:'textarea',children:['Legacy notes']}}));
 assert.match(legacy,/>Legacy notes<\/textarea>/);
});

test('authored form identity and revision fields render once inside an inert boundary',()=>{
 const markup=renderToStaticMarkup(React.createElement(HtmlThingRenderer,{node:{tag:'tt-form',props:{identityName:'id',identity:'record-1',revisionName:'expectedUpdatedAt',revision:'original-stamp'},children:[{tag:'input',props:{name:'title',value:'Existing record'}}]}}));
 assert.match(markup,/<fieldset disabled=""/);
 assert.match(markup,/name="id" value="record-1"/);
 assert.match(markup,/name="expectedUpdatedAt" value="original-stamp"/);
});

test('authored discussions remain inert and ignore forged post projections in previews', () => {
 const markup = renderToStaticMarkup(React.createElement(HtmlThingRenderer, { node: {
  tag: 'tt-discussion', props: { thingId: 'private-target', initialPost: { text: 'forged content' }, description: 'private description' },
  children: [{ tag: 'button', children: ['Forged action'] }]
 } }));
 assert.match(markup, /Discussion is available on the interactive page/);
 assert.doesNotMatch(markup, /private-target|private description|forged content|Forged action|data-tt-discussion/);
});

test('interactive discussions reject malformed or unbounded targets before mounting a loader', () => {
 for (const thingId of [undefined, {}, '', '/api/private', 'https://other.example/thing', 'a'.repeat(161)]) {
  const markup = renderToStaticMarkup(React.createElement(NativeControlsEnabled.Provider, { value: true },
   React.createElement(HtmlThingRenderer, { node: { tag: 'tt-discussion', props: { thingId } } })));
  assert.match(markup, /Choose a Thing to display its discussion/);
  assert.doesNotMatch(markup, /data-tt-discussion|Refresh comments/);
 }
});
