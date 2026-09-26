import assert from 'node:assert/strict';
import test from 'node:test';
import { componentStyleRules } from './componentStyleRules';

test('each comma-separated selector remains inside its own instance without increasing specificity', () => {
	const css = componentStyleRules([{ selector: '.card, button:hover', declarations: { color: 'var(--app-ink, #18392d)', padding: '12px' } }], 'one');
	assert.equal(css, ':where([data-tt-style="one"]) .card,:where([data-tt-style="one"]) button:hover{color:var(--app-ink, #18392d);padding:12px}');
	assert.ok(!componentStyleRules([{ selector: '.card', declarations: { color: 'red' } }], 'two').includes('"one"'));
});

test('authored declaration order and bounded responsive overrides survive serialization', () => {
	const css = componentStyleRules(
		[
			{ selector: '.card', declarations: { color: 'inherit', '--accent': '#176340' } },
			{ selector: '.card', declarations: { padding: '8px' }, maxWidth: 650 },
			{ selector: '.card.special', declarations: { padding: '16px' } }
		],
		'scope'
	);
	assert.match(css, /@media\(max-width:650px\)/);
	assert.ok(css.indexOf('padding:8px') < css.indexOf('padding:16px'));
	assert.match(css, /color:inherit;--accent:#176340/);
});

test('style rules reject scope escape, resource loads, injection and viewport positioning', () => {
	const rule = (selector: string, declarations: Record<string, string>) => [{ selector, declarations }];
	for (const selector of ['.x} body{', ':has(body)', '@import', '.x/* comment */'])
		assert.equal(componentStyleRules(rule(selector, { color: 'red' }), 'safe'), '');
	// A leading sibling combinator would reach the app element rendered next to
	// this instance instead of staying inside its own subtree.
	for (const selector of ['+ *', '+ .chrome', '.a, + .chrome', '~ .chrome'])
		assert.equal(componentStyleRules(rule(selector, { display: 'none' }), 'safe'), '');
	// A child combinator still selects inside the instance, and a sibling
	// combinator between two authored nodes stays contained.
	assert.equal(componentStyleRules(rule('> *', { color: 'red' }), 'safe'), ':where([data-tt-style="safe"]) > *{color:red}');
	assert.equal(componentStyleRules(rule('.a + .b', { color: 'red' }), 'safe'), ':where([data-tt-style="safe"]) .a + .b{color:red}');
	// An unbalanced delimiter must not reach the stylesheet: the CSS parser
	// consumes `(` and `[` as blocks, so it would swallow this rule's body and
	// every later rule in the same instance the way `/*` would.
	for (const selector of ['.a(', '.a[', '.a)', '.a]', ':is(.a', '.a:not(', '.a(]', '.a) , (.b'])
		assert.equal(componentStyleRules(rule(selector, { color: 'red' }), 'safe'), '');
	assert.equal(
		componentStyleRules([{ selector: '.a(', declarations: { color: 'red' } }, { selector: '.b', declarations: { color: 'green' } }], 'safe'),
		'\n:where([data-tt-style="safe"]) .b{color:green}'
	);
	// Only a top-level comma separates the selector list, so a nested argument
	// list keeps one namespace prefix on its own compound.
	assert.equal(componentStyleRules(rule(':is(.a, .b) .c', { color: 'red' }), 'safe'), ':where([data-tt-style="safe"]) :is(.a, .b) .c{color:red}');
	assert.equal(componentStyleRules(rule('[title="a,b"]', { color: 'red' }), 'safe'), ':where([data-tt-style="safe"]) [title="a,b"]{color:red}');
	// A combinator nested in an argument list needs no guard: the prefix still
	// constrains the subject element to this instance's subtree.
	assert.equal(componentStyleRules(rule(':is(.a, + .chrome)', { color: 'red' }), 'safe'), ':where([data-tt-style="safe"]) :is(.a, + .chrome){color:red}');
	for (const value of [
		'url(https://example.test/pixel)',
		'URL (x)',
		'image-set("https://example.test/pixel")',
		'red;}body{color:red',
		'red\\3b color:red',
		'red/*',
		'*/red'
	])
		assert.equal(componentStyleRules(rule('.x', { color: value }), 'safe'), '');
	// A comment delimiter must not hide the rules authored after it.
	assert.equal(
		componentStyleRules([{ selector: '.a', declarations: { color: 'red/*' } }, { selector: '.b', declarations: { color: 'green' } }], 'safe'),
		'\n:where([data-tt-style="safe"]) .b{color:green}'
	);
	assert.match(componentStyleRules(rule('.x', { font: '12px/1.5 serif', 'aspect-ratio': '16 / 9' }), 'safe'), /font:12px\/1\.5 serif;aspect-ratio:16 \/ 9/);
	assert.equal(componentStyleRules(rule('.x', { position: 'fixed', 'z-index': '99999' }), 'safe'), '');
	assert.equal(componentStyleRules(rule('.x', { color: 'red' }), 'bad"scope'), '');
	assert.equal(componentStyleRules(Array(221).fill(rule('.x', { color: 'red' })[0]), 'safe'), '');
});
