import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ALLOWED_PROPS } from './HtmlThingRenderer.tsx';

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
