import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColor, rgbaToHex } from './styleColor';
import { sanitizeStyleTokens, sanitizeInlineStyle, styleTokensToCss, FONT_STACKS, tokensToInlineStyle } from './styleTokens';
import { sanitizeEditorJsInlineHtml } from './inlineHtmlText';
import { inlineToolbarPosition } from './editorJsInlinePosition';

test('RGB, RGBA, HSL and alpha hex converge on the same safe colour', () => {
	for (const value of ['#f008', '#ff000088', 'rgba(255, 0, 0, 0.5333333)', 'hsl(0 100% 50% / 53.33333%)'])
		assert.equal(rgbaToHex(parseColor(value)!), '#ff000088');
	assert.equal(rgbaToHex(parseColor('rgb(100% 0% 0%)')!), '#ff0000');
	assert.equal(parseColor('rgb(NaN,0,0)'), null);
	assert.equal(parseColor('var(--arbitrary)'), null);
});
test('custom size units and legacy px survive rendering and hostile values do not', () => {
	for (const size of [24, '24px', '1.25em', '1.5rem', '18pt', '125%'])
		assert.equal(styleTokensToCss(sanitizeStyleTokens({ size })).fontSize, typeof size === 'number' ? `${size}px` : size);
	for (const size of ['calc(100vw)', '1px;position:fixed', '', {}, Infinity]) assert.deepEqual(sanitizeStyleTokens({ size }), {});
	assert.equal(sanitizeStyleTokens({ size: '500em' }).size, '15em');
	assert.deepEqual(sanitizeStyleTokens({ font: '__proto__' }), {});
});
test('inline sanitizer retains validated decorations and rejects CSS or HTML injection', () => {
	const safe = 'color:#ff000088;font-size:1.5rem;text-decoration:underline line-through';
	assert.equal(
		sanitizeEditorJsInlineHtml(`<span onclick="evil()" style="${safe};position:fixed;background-image:url(https://evil.test)">hi</span>`),
		`<span style="${safe}">hi</span>`
	);
	assert.equal(sanitizeInlineStyle('color:expression(alert(1));font-family:evil;font-size:var(--bad);background-color:url(x)'), '');
	for (const font of Object.keys(FONT_STACKS)) {
		const css = tokensToInlineStyle({ font: font as keyof typeof FONT_STACKS });
		assert.equal(sanitizeInlineStyle(css), css);
	}
	const html = '<span style="color:rgba(1,2,3,0.5);font-size:125%">a<b>b</b></span>';
	assert.equal(sanitizeEditorJsInlineHtml(sanitizeEditorJsInlineHtml(html)), sanitizeEditorJsInlineHtml(html));
});
test('selection toolbar sits above selection and clamps to the panned visual viewport', () => {
	const pos = inlineToolbarPosition({ left: 280, top: 400, width: 90 }, { width: 320, height: 48 }, { left: 0, top: 0, width: 390 });
	assert.ok(pos.top + 48 < 400);
	assert.ok(pos.left >= 8 && pos.left + 320 <= 382);
	assert.equal(inlineToolbarPosition({ left: 0, top: 20, width: 20 }, { width: 180, height: 48 }, { left: 10, top: 30, width: 300 }).top, 38);
});
