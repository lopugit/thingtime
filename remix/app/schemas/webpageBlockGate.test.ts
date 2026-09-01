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
