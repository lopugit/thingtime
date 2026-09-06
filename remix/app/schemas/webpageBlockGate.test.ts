import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_WEBPAGE_HTML_CHARS, validateThingtimeCrystal } from './registry.ts';

// The Figma-layer block fields (css / tag / html, media + html block types):
// custom styling round-trips through the write gate while the classic css/url
// escape hatches and unbounded payloads stay out. Rendered markup is ONLY
// drawn through the sanitising allowlist renderer — the gate's job here is
// bounds + construct blocking.

const page = (blocks: unknown[]) => validateThingtimeCrystal(['webpage'], { name: 'Gate', version: 1, blocks });

const okBlocks = (result: ReturnType<typeof validateThingtimeCrystal>): any[] => {
	assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
	return (result as any).crystal.blocks;
};

test('css record, tag, and rich html survive on text blocks', () => {
	const blocks = okBlocks(
		page([
			{
				id: 'head-1',
				type: 'text',
				text: 'Left',
				style: 'heading',
				tag: 'h3',
				html: 'Left <b>cell</b> with <span style="color: hotpink;">rich</span> text',
				css: { 'font-size': '22px', color: '#334455', '--tt-custom': '4px' }
			}
		])
	);
	assert.equal(blocks[0].tag, 'h3');
	assert.equal(blocks[0].css['font-size'], '22px');
	assert.equal(blocks[0].css['--tt-custom'], '4px');
	assert.ok(String(blocks[0].html).includes('<b>'));
});

test('media and html block types round-trip', () => {
	const blocks = okBlocks(
		page([
			{ id: 'media-1', type: 'media', media: 'image', src: 'https://example.com/pic.png', alt: 'a picture' },
			{ id: 'media-2', type: 'media', media: 'video', src: '/api/v1/attachments/content?id=abc' },
			{ id: 'html-1', type: 'html', html: '<div style="padding: 12px;"><strong>raw</strong></div>' }
		])
	);
	assert.equal(blocks[0].src, 'https://example.com/pic.png');
	assert.equal(blocks[1].media, 'video');
	assert.ok(String(blocks[2].html).includes('<strong>'));
});

test('css escape hatches are rejected', () => {
	assert.equal(page([{ id: 'x1', type: 'text', text: 'hi', css: { background: 'url(javascript:alert(1))' } }]).ok, false);
	assert.equal(page([{ id: 'x2', type: 'text', text: 'hi', css: { width: 'expression(alert(1))' } }]).ok, false);
	assert.equal(page([{ id: 'x4', type: 'text', text: 'hi', css: { 'font-size': '<script>' } }]).ok, false);
	assert.equal(page([{ id: 'x5', type: 'text', text: 'hi', css: { 'Bad Key': '10px' } }]).ok, false);
});

test('safe css url() targets pass, unsafe ones fail', () => {
	assert.equal(page([{ id: 'u1', type: 'text', text: 'hi', css: { background: 'url(https://example.com/bg.png)' } }]).ok, true);
	assert.equal(page([{ id: 'u2', type: 'text', text: 'hi', css: { background: 'url(/local/bg.png)' } }]).ok, true);
	assert.equal(page([{ id: 'u3', type: 'text', text: 'hi', css: { background: 'url(data:image/png;base64,AAA)' } }]).ok, true);
	assert.equal(page([{ id: 'u4', type: 'text', text: 'hi', css: { background: 'url(http://plain.example/bg.png)' } }]).ok, false);
	assert.equal(page([{ id: 'u5', type: 'text', text: 'hi', css: { background: 'url(//protocol.relative/x)' } }]).ok, false);
});

test('text href accepts page links and refuses script/data/plain-http targets', () => {
	const blocks = okBlocks(
		page([
			{ id: 'l1', type: 'text', text: 'Docs', href: 'https://thingtime.com/docs' },
			{ id: 'l2', type: 'text', text: 'Register', href: '/register' },
			{ id: 'l3', type: 'text', text: 'Mail', href: 'mailto:hello@example.com' },
			{ id: 'l4', type: 'text', text: 'Call', href: 'tel:+61400000000' },
			{ id: 'l5', type: 'text', text: 'Plain', href: '  ' }
		])
	);
	assert.equal(blocks[0].href, 'https://thingtime.com/docs');
	assert.equal(blocks[1].href, '/register');
	assert.equal(blocks[2].href, 'mailto:hello@example.com');
	assert.equal(blocks[3].href, 'tel:+61400000000');
	// blank hrefs vanish rather than becoming empty anchors
	assert.equal('href' in blocks[4], false);
	assert.equal(page([{ id: 'b1', type: 'text', text: 'x', href: 'javascript:alert(1)' }]).ok, false);
	assert.equal(page([{ id: 'b2', type: 'text', text: 'x', href: 'data:text/html,hi' }]).ok, false);
	assert.equal(page([{ id: 'b3', type: 'text', text: 'x', href: 'http://plain.example/' }]).ok, false);
	assert.equal(page([{ id: 'b4', type: 'text', text: 'x', href: '//protocol.relative/x' }]).ok, false);
	assert.equal(page([{ id: 'b5', type: 'text', text: 'x', href: 'mailto: spaced@example.com' }]).ok, false);
	assert.equal(page([{ id: 'b6', type: 'text', text: 'x', href: `/${'a'.repeat(3000)}` }]).ok, false);
});

// The URL parser folds `\` into `/` for http(s), so a single leading slash
// followed by a backslash is protocol-relative in disguise: `/\evil.example`
// resolves to https://evil.example. /p/ draws ANOTHER user's page, so a link
// or media src that reads site-relative must never resolve off-origin.
test('backslash-folded authorities are refused wherever a site-relative url is allowed', () => {
	for (const href of ['/\\evil.example/login', '/\\\\evil.example', '/\\/evil.example']) {
		assert.equal(page([{ id: 'bs1', type: 'text', text: 'x', href }]).ok, false, `expected href ${href} to be refused`);
		assert.equal(page([{ id: 'bs2', type: 'media', src: href }]).ok, false, `expected media src ${href} to be refused`);
		assert.equal(page([{ id: 'bs3', type: 'text', text: 'x', css: { background: `url(${href})` } }]).ok, false, `expected css url ${href} to be refused`);
	}
	// a backslash further along the path never forms an authority, and the
	// ordinary site-relative link keeps working
	assert.equal(page([{ id: 'bs4', type: 'text', text: 'x', href: '/docs/a\\b' }]).ok, true);
	assert.equal(page([{ id: 'bs5', type: 'text', text: 'x', href: '/register' }]).ok, true);
});

test('media src and text tag stay on the allowlists', () => {
	assert.equal(page([{ id: 'm1', type: 'media', src: 'ftp://nope.com/x.png' }]).ok, false);
	assert.equal(page([{ id: 'm2', type: 'media', src: 'javascript:alert(1)' }]).ok, false);
	assert.equal(page([{ id: 'm3', type: 'media', media: 'gif' }]).ok, false);
	assert.equal(page([{ id: 't1', type: 'text', text: 'hi', tag: 'script' }]).ok, false);
	assert.equal(page([{ id: 't2', type: 'text', text: 'hi', tag: 'iframe' }]).ok, false);
});

test('html payloads are bounded', () => {
	assert.equal(page([{ id: 'h1', type: 'html', html: 'a'.repeat(MAX_WEBPAGE_HTML_CHARS + 1) }]).ok, false);
	assert.equal(page([{ id: 'h2', type: 'html', html: '' }]).ok, false);
	assert.equal(page([{ id: 'h3', type: 'text', text: 'hi', html: 'b'.repeat(MAX_WEBPAGE_HTML_CHARS + 1) }]).ok, false);
});

// previewBg is drawn on /p/<id>, where the viewer is not the author, so it has
// to clear the same bar as every other author-supplied css value on the page —
// not just the older "no angle brackets, no javascript:" component-era screen.
const pageBg = (previewBg: string) => validateThingtimeCrystal(['webpage'], { name: 'Gate', version: 1, blocks: [], previewBg });

test('previewBg accepts ordinary background values', () => {
	for (const value of [
		'#fafafb',
		'linear-gradient(180deg, #fff 0%, #eee 100%)',
		'radial-gradient(circle at 10% 20%, #fff, #000)',
		'var(--tt-surface, #fafafb)',
		'rgba(0, 0, 0, 0.5)',
		'url("/img/dots.png") repeat',
		'url(https://cdn.example.com/a.png) center/cover no-repeat'
	]) {
		assert.equal(pageBg(value).ok, true, `expected previewBg to accept ${value}`);
	}
});

test('previewBg refuses rule breakout and unsafe url() targets', () => {
	for (const value of [
		'red; } body { display: none } .x {', // escapes the emitted rule entirely
		'@import url(//evil.example/x.css)',
		'expression(alert(1))',
		'url(javascript:alert(1))',
		'<script>',
		'url(//protocol.relative/track.png)',
		'url(http://plain.example/track.png)'
	]) {
		assert.equal(pageBg(value).ok, false, `expected previewBg to refuse ${value}`);
	}
});

// ── source-bound component blocks (the page runtime's data binding) ────────

test('a component block keeps a well-formed source binding and refuses malformed ones', () => {
	const base = { name: 'Bound page', blocks: [{ id: 'hud', type: 'component', component: 'app-pokeworld-hud', source: { action: 'app-pokeworld-state', inputs: { page: '{query.page}', n: 2, live: true }, refresh: 'interval', intervalMs: 15000 } }] };
	const ok = validateThingtimeCrystal(['webpage'], base);
	assert.equal(ok.ok, true, ok.ok === false ? ok.error : '');
	if (ok.ok) {
		const block = (ok.crystal.blocks as Record<string, unknown>[])[0];
		assert.deepEqual(block.source, { action: 'app-pokeworld-state', inputs: { page: '{query.page}', n: 2, live: true }, refresh: 'interval', intervalMs: 15000 });
	}
	const loadDefault = validateThingtimeCrystal(['webpage'], { ...base, blocks: [{ ...base.blocks[0], source: { action: 'app-pokeworld-state', refresh: 'load' } }] });
	assert.equal(loadDefault.ok, true);
	if (loadDefault.ok) assert.deepEqual((loadDefault.crystal.blocks as Record<string, unknown>[])[0].source, { action: 'app-pokeworld-state' });
	const badAction = validateThingtimeCrystal(['webpage'], { ...base, blocks: [{ ...base.blocks[0], source: { action: 'Not A Slug' } }] });
	assert.equal(badAction.ok, false);
	const badRefresh = validateThingtimeCrystal(['webpage'], { ...base, blocks: [{ ...base.blocks[0], source: { action: 'x', refresh: 'always' } }] });
	assert.equal(badRefresh.ok, false);
	const tooFast = validateThingtimeCrystal(['webpage'], { ...base, blocks: [{ ...base.blocks[0], source: { action: 'x', refresh: 'interval', intervalMs: 100 } }] });
	assert.equal(tooFast.ok, false);
	const objectInput = validateThingtimeCrystal(['webpage'], { ...base, blocks: [{ ...base.blocks[0], source: { action: 'x', inputs: { nested: { a: 1 } } } }] });
	assert.equal(objectInput.ok, false);
	const suiteKey = validateThingtimeCrystal(['webpage'], { ...base, suiteKey: 'pokeworld' });
	assert.equal(suiteKey.ok, true);
	if (suiteKey.ok) assert.equal(suiteKey.crystal.suiteKey, 'pokeworld');
});
