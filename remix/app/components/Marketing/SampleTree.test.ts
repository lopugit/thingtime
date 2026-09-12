import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// @ts-ignore Node executes this TypeScript test directly and requires the .tsx extension.
import {
	KIND_CHIPS,
	MAX_TREE_CHILDREN,
	MAX_TREE_DEPTH,
	RAINBOW,
	SampleTree,
	countLabel,
	formatLeaf,
	highlightTitle,
	kindOf,
	rainbowAlpha
} from './SampleTree.tsx';

const render = (value: unknown, depth?: number) => renderToStaticMarkup(React.createElement(SampleTree, { value, depth }));
const renderTitle = (title: string, highlight?: string) => renderToStaticMarkup(React.createElement('h1', null, highlightTitle(title, highlight)));

const count = (html: string, needle: string) => html.split(needle).length - 1;
const depthsIn = (html: string) => Array.from(html.matchAll(/data-depth="(\d+)"/g)).map((match) => Number(match[1]));

test('kindOf classifies every JSON-like value', () => {
	assert.equal(kindOf({}), 'object');
	assert.equal(kindOf([]), 'array');
	assert.equal(kindOf('x'), 'string');
	assert.equal(kindOf(3), 'number');
	assert.equal(kindOf(true), 'boolean');
	assert.equal(kindOf(null), 'null');
	assert.equal(kindOf(undefined), 'null');
});

test('leaf formatting quotes strings, keeps numbers and says Yes/No', () => {
	assert.equal(formatLeaf('hello'), '“hello”');
	assert.equal(formatLeaf(42), '42');
	assert.equal(formatLeaf(true), 'Yes');
	assert.equal(formatLeaf(false), 'No');
	assert.equal(countLabel({ a: 1, b: 2 }), '2 keys');
	assert.equal(countLabel({ a: 1 }), '1 key');
	assert.equal(countLabel([1, 2, 3]), '3 items');
	assert.equal(countLabel('x'), null);
});

test('depth guides cycle through the five rainbow stops at 34% alpha', () => {
	assert.equal(RAINBOW.length, 5);
	assert.equal(rainbowAlpha(0, 0.34), 'rgba(243,74,74,0.34)');
	assert.equal(rainbowAlpha(5, 0.34), rainbowAlpha(0, 0.34));
	assert.equal(rainbowAlpha(4, 0.34), 'rgba(165,85,232,0.34)');
});

test('SampleTree renders chips, keys, count pills and leaf values', () => {
	const html = render({
		car: { make: 'Tesla', km: 12000, electric: true, sold: false, notes: null, repairs: ['brakes', 'tyres'] }
	});
	assert.ok(html.includes('data-testid="marketing-sample-tree"'));
	for (const chip of Object.values(KIND_CHIPS)) assert.ok(html.includes(chip), `missing ${chip} chip`);
	assert.ok(html.includes('aria-label="object"'));
	assert.ok(html.includes('aria-label="array"'));
	assert.ok(html.includes('>car<'));
	assert.ok(html.includes('>make<'));
	assert.ok(html.includes('6 keys'));
	assert.ok(html.includes('2 items'));
	assert.ok(html.includes('“Tesla”'));
	assert.ok(html.includes('>12000<'));
	assert.ok(html.includes('>Yes<'));
	assert.ok(html.includes('>No<'));
	assert.ok(html.includes('rgba(243,74,74,0.34)'), 'depth 0 guide is red');
	assert.ok(html.includes('rgba(255,188,72,0.34)'), 'depth 1 guide is amber');
	assert.ok(html.includes('rgba(88,202,112,0.34)'), 'depth 2 guide is green');
	assert.ok(html.includes('padding-left:18px'), 'children indent 18px');
	assert.ok(html.includes('background:var(--mk-tint)'), 'chips read the trend tint');
	assert.ok(!/chakra|css-[a-z0-9]{5,}/.test(html), 'SampleTree stays Chakra-free');
});

test('SampleTree caps depth at MAX_TREE_DEPTH', () => {
	let value: Record<string, unknown> = { leaf: 'bottom' };
	for (let level = 0; level < 12; level += 1) value = { [`level${level}`]: value };
	const html = render(value);
	const depths = depthsIn(html);
	assert.equal(MAX_TREE_DEPTH, 6);
	assert.equal(Math.max(...depths), MAX_TREE_DEPTH);
	assert.ok(!html.includes('“bottom”'), 'rows past the cap are collapsed');
	assert.ok(html.includes('mk-tree-collapsed'), 'the capped row shows an ellipsis');
	assert.equal(count(html, 'aria-label="object"'), MAX_TREE_DEPTH + 1, 'one object row per rendered depth');
});

test('SampleTree caps children at MAX_TREE_CHILDREN with a "… n more" row', () => {
	const wide = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, index]));
	const html = render({ wide });
	assert.equal(MAX_TREE_CHILDREN, 24);
	assert.equal(count(html, 'aria-label="number"'), MAX_TREE_CHILDREN);
	assert.ok(html.includes('data-testid="marketing-sample-more"'));
	assert.ok(html.includes('… 16 more'));
	assert.ok(html.includes('40 keys'));

	const rootWide = render(wide);
	assert.equal(count(rootWide, 'aria-label="number"'), MAX_TREE_CHILDREN, 'the root is capped too');
	assert.ok(rootWide.includes('… 16 more'));
});

test('SampleTree handles empty branches, primitive roots and a starting depth', () => {
	assert.ok(render({}).includes('nothing here yet'));
	assert.ok(render({ list: [] }).includes('0 items'));
	const primitive = render('solo');
	assert.ok(primitive.includes('“solo”'));
	assert.ok(!primitive.includes('mk-tree-key'), 'a primitive root has no key');
	assert.ok(render({ a: 1 }, 3).includes('data-depth="3"'));
});

test('highlightTitle wraps the first whole-word match, case-insensitively, keeping the source casing', () => {
	const html = renderTitle('Everything is a Thing. Make it a thing.', 'thing');
	assert.equal(count(html, 'data-testid="marketing-highlight"'), 1, 'only the first occurrence is wrapped');
	assert.ok(html.includes('<span class="mk-highlight" data-testid="marketing-highlight" style="'), 'the span carries the rainbow style inline');
	assert.ok(html.includes('background-clip:text'));
	assert.ok(html.includes('animation:var(--tt-rainbow-anim, moving-rainbow 5s linear infinite)'), 'rainbow motion rides the theme switch');
	assert.ok(html.includes('>Thing</span>. Make it a thing.</h1>'), 'source casing is kept and the rest of the title follows');
	assert.ok(html.startsWith('<h1>Everything is a <span'), 'Everything is not a whole-word match');
});

test('highlightTitle returns the plain title when there is nothing to highlight', () => {
	assert.equal(highlightTitle('Plain title'), 'Plain title');
	assert.equal(highlightTitle('Plain title', ''), 'Plain title');
	assert.equal(highlightTitle('Plain title', '   '), 'Plain title');
	assert.equal(highlightTitle('Plain title', 'missing'), 'Plain title');
	assert.equal(highlightTitle('Everything', 'thing'), 'Everything', 'partial words never highlight');
	assert.equal(highlightTitle('', 'thing'), '');
});

test('highlightTitle copes with punctuation, emoji, regex characters and multi-word highlights', () => {
	assert.ok(renderTitle('📦 Trip planner template', 'Trip planner').includes('>Trip planner</span> template'));
	assert.ok(renderTitle('Feed algorithms: your questions', 'Feed algorithms').includes('>Feed algorithms</span>: your questions'));
	assert.ok(renderTitle('What is C++?', 'C++').includes('>C++</span>?'));
	assert.ok(renderTitle('Made for (almost) everyone', '(almost)').includes('>(almost)</span> everyone'));
	assert.ok(renderTitle('Made for  double  spaces', 'double spaces').includes('>double  spaces</span>'));
	const leading = renderTitle('Themes for creators', 'themes');
	assert.ok(leading.startsWith('<h1><span'), 'a match at the start has no leading text node');
	const trailing = renderTitle('Built for creators', 'creators');
	assert.ok(trailing.endsWith('creators</span></h1>'), 'a match at the end has no trailing text node');
});
