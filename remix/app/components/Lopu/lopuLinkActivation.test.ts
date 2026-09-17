import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { handlesLopuLinkInApp } from './lopuLinkActivation';

// 🦄 The floating Lopu header's expand control is a real link, so the browser
// keeps new-tab/new-window/copy-address behaviour while a plain click still
// expands in place. The boundary that missed this was the control being a
// <button>, so these checks pin both halves: the activation rule itself and the
// LopuHost wiring that renders the anchor at the same path the router uses.

const plainClick = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

const source = readFileSync(new URL('./LopuHost.tsx', import.meta.url), 'utf8');

test('a plain primary activation stays in the app, including keyboard Enter', () => {
	assert.equal(handlesLopuLinkInApp(plainClick), true);
	// Enter on a focused anchor reports the primary button with no modifiers
	assert.equal(handlesLopuLinkInApp({ ...plainClick, button: 0 }), true);
});

test('every modified, auxiliary or already-handled activation is left to the browser', () => {
	for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'] as const) {
		assert.equal(handlesLopuLinkInApp({ ...plainClick, [modifier]: true }), false, `${modifier} must reach the browser`);
	}
	// middle-click (new tab) and right-click (context menu) never expand in place
	assert.equal(handlesLopuLinkInApp({ ...plainClick, button: 1 }), false);
	assert.equal(handlesLopuLinkInApp({ ...plainClick, button: 2 }), false);
	// something upstream already cancelled the navigation: do not act twice
	assert.equal(handlesLopuLinkInApp({ ...plainClick, defaultPrevented: true }), false);
});

test('the expand control renders an anchor and only buttons keep the button type', () => {
	assert.match(source, /as=\{props\.href \? 'a' : 'button'\}/, 'an href makes the header control a real anchor');
	assert.match(source, /props\.href \? \{ href: props\.href \} : \{ type: 'button' as const \}/, 'only anchors receive href and only buttons receive type');
	// the guard is the shared rule, not a hand-rolled copy that can drift
	assert.match(source, /if \(!handlesLopuLinkInApp\(event\)\) return;/);
	assert.match(source, /handlesLopuLinkInApp/);
});

test('the href and the in-app navigation resolve from one destination', () => {
	assert.match(source, /const fullPath = voiceMode \? LOPU_VOICE_PATH : LOPU_PAGE_PATH;/, 'both modes read the canonical route constants');
	assert.match(source, /navigate\(fullPath\);/, 'the router uses the same value the anchor exposes');
	assert.match(source, /href=\{fullPath\}/, 'the anchor uses the same value the router navigates to');
	// no hardcoded duplicate of the page path that could drift from the route table
	assert.doesNotMatch(source, /href=\{voiceMode \? LOPU_VOICE_PATH : '\/lopu'\}/);
	assert.doesNotMatch(source, /navigate\(voiceMode \? LOPU_VOICE_PATH : '\/lopu'\)/);
});
