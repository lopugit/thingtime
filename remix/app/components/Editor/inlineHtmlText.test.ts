import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { inlineHtmlToText, sanitizeEditorJsInlineHtml } from './inlineHtmlText.ts';

test('turns Editor.js inline markup into plain text', () => {
	assert.equal(inlineHtmlToText('Fish &amp; Chips<br><b>today</b>'), 'Fish & Chips\ntoday');
});

test('decodes escaped entities exactly once', () => {
	assert.equal(inlineHtmlToText('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
});

test('drops unsafe element contents identically without a DOM', () => {
	assert.equal(inlineHtmlToText('<script>alert(1)</script><style>bad</style><template>hidden</template>Safe'), 'Safe');
});

test('preserves safe Editor.js markup and removes unsafe attributes', () => {
	assert.equal(
		sanitizeEditorJsInlineHtml('<b>Bold</b> <a href="https://example.com" onclick="bad()">link</a>'),
		'<b>Bold</b> <a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>'
	);
});

test('unwraps unsafe and double-encoded links', () => {
	assert.equal(sanitizeEditorJsInlineHtml('<a href="javascript:alert(1)">bad</a>'), 'bad');
	assert.equal(sanitizeEditorJsInlineHtml('<a href="java&amp;#x73;cript:alert(1)">also bad</a>'), 'also bad');
});

test('uses one deterministic entity policy for text and HTML', () => {
	assert.equal(inlineHtmlToText('© &copy; &amp;lt;'), '© &copy; &lt;');
	assert.equal(sanitizeEditorJsInlineHtml('© &copy; &amp;lt;'), '© &amp;copy; &amp;lt;');
});

test('preserves the complete inline allowlist and repairs nesting', () => {
	assert.equal(
		sanitizeEditorJsInlineHtml('<b>b<strong>s<i>i<em>e<u>u<s>s<mark>m<code>c<br>n</b>'),
		'<b>b<strong>s<i>i<em>e<u>u<s>s<mark>m<code>c<br/>n</code></mark></s></u></em></i></strong></b>'
	);
});

test('rejects numeric control-obfuscated schemes', () => {
	assert.equal(sanitizeEditorJsInlineHtml('<a href="java&#x0a;script:alert(1)">bad</a>'), 'bad');
});

test('allows protocol-relative web links explicitly', () => {
	assert.equal(
		sanitizeEditorJsInlineHtml('<a href="//cdn.example.com/page">cdn</a>'),
		'<a href="//cdn.example.com/page" target="_blank" rel="noopener noreferrer">cdn</a>'
	);
});

test('caps inline tag nesting without losing text', () => {
	const nested = `${'<b>'.repeat(200)}content${'</b>'.repeat(200)}`;
	assert.equal(sanitizeEditorJsInlineHtml(nested), `${'<b>'.repeat(64)}content${'</b>'.repeat(64)}`);
	assert.equal(inlineHtmlToText(nested), 'content');
});

test('rejects object and array fields before string coercion', () => {
	assert.equal(sanitizeEditorJsInlineHtml(Array.from({ length: 10_000 }, () => '<b>x</b>')), '');
	assert.equal(inlineHtmlToText({ text: '<b>x</b>' }), '');
	assert.equal(inlineHtmlToText(42), '42');
});
