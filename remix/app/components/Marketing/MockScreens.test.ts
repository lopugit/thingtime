import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// @ts-ignore Node executes this TypeScript test directly and requires the .tsx extension.
import { MOCK_SCREENS, MOCK_SCREEN_KEYS, MockScreen } from './MockScreens.tsx';
// @ts-ignore Node executes this TypeScript test directly and requires the .ts extension.
import { SCREEN_TARGETS, WALKTHROUGHS } from '../../marketing/walkthroughs.ts';

const render = (screen: string, active: string | null = null, typed: Record<string, string> = {}) =>
	renderToStaticMarkup(React.createElement(MockScreen, { screen, active, typed }));

const targetsIn = (html: string) => [...html.matchAll(/data-wt="([^"]+)"/g)].map((match) => match[1]);

test('every mock screen renders every SCREEN_TARGETS entry exactly once, and nothing else', () => {
	assert.deepEqual([...MOCK_SCREEN_KEYS].sort(), Object.keys(MOCK_SCREENS).sort());
	for (const screen of Object.keys(SCREEN_TARGETS)) {
		const html = render(screen);
		const found = targetsIn(html);
		for (const target of SCREEN_TARGETS[screen]) {
			assert.equal(found.filter((name) => name === target).length, 1, `${screen} renders ${target} ${found.filter((name) => name === target).length} times`);
		}
		for (const name of found) assert.ok(SCREEN_TARGETS[screen].includes(name), `${screen} renders an unlisted target ${name}`);
		assert.ok(html.includes('data-mock-screen="' + screen + '"'));
		assert.ok(!/undefined|NaN|\[object/.test(html), `${screen} has a bad value`);
	}
});

test('every walkthrough target resolves to a rendered element on its screen', () => {
	const rendered = new Map<string, string[]>();
	for (const walkthrough of WALKTHROUGHS) {
		if (!rendered.has(walkthrough.screen)) rendered.set(walkthrough.screen, targetsIn(render(walkthrough.screen)));
		const found = rendered.get(walkthrough.screen)!;
		for (const step of walkthrough.steps) assert.ok(found.includes(step.target), `${walkthrough.key}: ${step.target} is not rendered on ${walkthrough.screen}`);
	}
});

test('typed text lands inside the target and the active target carries the ring marker', () => {
	const html = render('feed', 'composer-post', { composer: 'Trying polls in Thingtime 🌈' });
	assert.ok(html.includes('Trying polls in Thingtime 🌈'), 'typed text missing');
	assert.ok(!html.includes("What's on your mind?"), 'placeholder still shown after typing');
	const activeMatches = [...html.matchAll(/data-wt="([^"]+)" data-wt-active=""/g)].map((match) => match[1]);
	assert.deepEqual(activeMatches, ['composer-post']);

	const hero = render('builder', null, { 'block-hero': 'Own your data' });
	assert.ok(hero.includes('Own your data'));
	assert.ok(!hero.includes('A GUI for the internet.'), 'typed hero text should replace the placeholder copy');
});

test('an unknown screen key falls back to the feed instead of throwing', () => {
	const html = render('nope');
	assert.ok(html.includes('data-wt="composer"'));
});
